#!/usr/bin/env node
/* ============================================================
   validate-quizzes.js
   Valide tous les questionnaires du projet :
     1. JSON bien formé + schéma respecté (categories/questions)
     2. Questions mcq : options uniques, "correct" = entier index
     3. Questions text : "accepted" non vide
     4. Fichier référencé dans data/config.json (pas d'orphelin)
     5. Fichier de config existant sur disque (pas de mort)
     6. questionsCount du config = nombre réel de questions
     7. subject inconnu, id/fichier en doublon, texte en doublon
     8. champ "added" au format AAAA-MM-JJ
     9. (avertissement) service-worker.js contient bien le fichier
   Usage : node scripts/validate-quizzes.js
   Code retour : 0 = OK, 1 = erreurs
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const SW_PATH = path.join(ROOT, "service-worker.js");

const errors = [];
const warnings = [];

function err(file, msg) {
  errors.push({ file, msg });
}
function warn(file, msg) {
  warnings.push({ file, msg });
}

function walkJson(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (entry.endsWith(".json")) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function readJson(file) {
  try {
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

/* ----------------------------------------------------------
   1. Schéma d'un questionnaire
   ---------------------------------------------------------- */
function validateQuizSchema(file, data) {
  const f = rel(file);

  if (typeof data.subject !== "string" || !data.subject.trim())
    err(f, 'champ "subject" manquant ou vide (string attendu)');
  if (typeof data.title !== "string" || !data.title.trim())
    err(f, 'champ "title" manquant ou vide (string attendu)');
  if (typeof data.description !== "string" || !data.description.trim())
    err(f, 'champ "description" manquant ou vide (string attendu)');
  if (data.css !== undefined && typeof data.css !== "string")
    err(f, 'champ "css" doit être une string si présent');
  if (data.notepad !== undefined && typeof data.notepad !== "boolean")
    err(f, 'champ "notepad" doit être un boolean si présent');

  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    err(f, 'tableau "categories" manquant ou vide');
    return;
  }

  const seenCat = new Set();
  const seenQuestions = new Set();
  let total = 0;

  data.categories.forEach((cat, ci) => {
    const where = `categories[${ci}]`;
    if (typeof cat.category !== "string" || !cat.category.trim())
      err(f, `${where}.category manquant ou vide`);
    else if (seenCat.has(cat.category))
      err(f, `${where}: nom de catégorie en doublon "${cat.category}"`);
    else seenCat.add(cat.category);

    if (cat.notepad !== undefined && typeof cat.notepad !== "boolean")
      err(f, `${where}.notepad doit être un boolean`);

    if (!Array.isArray(cat.questions) || cat.questions.length === 0) {
      err(f, `${where}.questions manquant ou vide`);
      return;
    }

    cat.questions.forEach((q, qi) => {
      const at = `${where}.questions[${qi}]`;
      total++;

      if (typeof q.text !== "string" || !q.text.trim())
        err(f, `${at}: champ "text" manquant ou vide`);

      const key = (q.text || "").trim().replace(/\s+/g, " ");
      if (key) {
        if (seenQuestions.has(key))
          err(f, `${at}: texte de question en doublon "${key.slice(0, 70)}"`);
        seenQuestions.add(key);
      }

      if (typeof q.solution !== "string" || !q.solution.trim())
        err(f, `${at}: champ "solution" manquant ou vide (obligatoire)`);

      const type = q.type === undefined ? "mcq" : q.type;
      if (type !== "mcq" && type !== "text") {
        err(f, `${at}: type inconnu "${q.type}" (attendu "mcq" ou "text")`);
        return;
      }

      if (type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          err(f, `${at}: "options" doit être un tableau d'au moins 2 choix`);
          return;
        }
        q.options.forEach((o, oi) => {
          if (typeof o !== "string" || !o.trim())
            err(f, `${at}: options[${oi}] vide ou non-string`);
        });
        const dup = q.options
          .map((o) => String(o).trim())
          .filter((o, i, a) => a.indexOf(o) !== i);
        if (dup.length)
          err(f, `${at}: options en doublon [${dup.map((d) => `"${d}"`).join(", ")}]`);

        if (typeof q.correct !== "number" || !Number.isInteger(q.correct)) {
          err(
            f,
            `${at}: "correct" doit être un ENTIER = index 0-based dans "options" (reçu: ${JSON.stringify(q.correct)})`
          );
        } else if (q.correct < 0 || q.correct >= q.options.length) {
          err(
            f,
            `${at}: "correct"=${q.correct} hors bornes [0..${q.options.length - 1}]`
          );
        }
      } else {
        if (!Array.isArray(q.accepted) || q.accepted.length === 0) {
          err(f, `${at}: "accepted" non vide obligatoire pour type "text"`);
        } else {
          q.accepted.forEach((a, ai) => {
            if (typeof a !== "string" || !a.trim())
              err(f, `${at}: accepted[${ai}] vide ou non-string`);
          });
        }
        if (q.options !== undefined && !Array.isArray(q.options))
          err(f, `${at}: "options" doit être un tableau si présent`);
      }

      if (q.image !== undefined && (typeof q.image !== "string" || !q.image.trim()))
        err(f, `${at}: "image" doit être une string non vide si présent`);
    });
  });

  return total;
}

/* ----------------------------------------------------------
   Principal
   ---------------------------------------------------------- */
function main() {
  // --- config.json ---
  const cfgRead = readJson(CONFIG_PATH);
  if (cfgRead.error) {
    err("data/config.json", `JSON invalide: ${cfgRead.error}`);
    report();
    return;
  }
  const config = cfgRead.data;

  if (!Array.isArray(config.subjects) || config.subjects.length === 0)
    err("data/config.json", 'tableau "subjects" manquant ou vide');
  if (!Array.isArray(config.quizzes) || config.quizzes.length === 0)
    err("data/config.json", 'tableau "quizzes" manquant ou vide');

  const subjectIds = new Set(
    (Array.isArray(config.subjects) ? config.subjects : []).map((s) => s.id)
  );
  (Array.isArray(config.subjects) ? config.subjects : []).forEach((s, i) => {
    if (!s.id || !s.name)
      err("data/config.json", `subjects[${i}] incomplet (id/name requis)`);
  });

  const quizzes = Array.isArray(config.quizzes) ? config.quizzes : [];
  const seenIds = new Set();
  const seenFiles = new Set();
  const registeredFiles = new Set();

  quizzes.forEach((q, i) => {
    const at = `data/config.json → quizzes[${i}]`;
    if (!q.id) err(at, '"id" manquant');
    else if (seenIds.has(q.id)) err(at, `id en doublon "${q.id}"`);
    else seenIds.add(q.id);

    if (!q.file) {
      err(at, '"file" manquant');
    } else if (seenFiles.has(q.file)) {
      err(at, `fichier en doublon "${q.file}"`);
    } else {
      seenFiles.add(q.file);
      registeredFiles.add(q.file);
      if (!fs.existsSync(path.join(ROOT, q.file)))
        err(at, `fichier introuvable sur disque: ${q.file}`);
    }

    if (!q.title) err(at, '"title" manquant');
    if (!q.subject) err(at, '"subject" manquant');
    else if (subjectIds.size && !subjectIds.has(q.subject))
      err(at, `subject "${q.subject}" absent de config.subjects`);
    if (typeof q.questionsCount !== "number")
      err(at, '"questionsCount" manquant ou non numérique');
    if (q.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.added))
      err(at, `"added" doit être au format AAAA-MM-JJ (reçu: ${JSON.stringify(q.added)})`);
    if (q.tags !== undefined && !Array.isArray(q.tags))
      err(at, '"tags" doit être un tableau');
  });

  // --- fichiers sur disque ---
  const onDisk = walkJson(DATA_DIR)
    .map(rel)
    .filter((f) => f !== "data/config.json");

  onDisk.forEach((f) => {
    if (!registeredFiles.has(f))
      err(f, "orphelin: fichier présent dans data/ mais absent de data/config.json");
  });

  // --- schéma + coherence questionsCount ---
  quizzes.forEach((q) => {
    if (!q.file || !fs.existsSync(path.join(ROOT, q.file))) return;
    const r = readJson(path.join(ROOT, q.file));
    if (r.error) {
      err(q.file, `JSON invalide: ${r.error}`);
      return;
    }
    const total = validateQuizSchema(path.join(ROOT, q.file), r.data);
    if (total !== undefined && typeof q.questionsCount === "number" && total !== q.questionsCount)
      err(q.file, `questionsCount incohérent: config=${q.questionsCount}, réel=${total}`);
    if (r.data && r.data.subject && q.subject && r.data.subject !== q.subject)
      err(q.file, `subject du fichier "${r.data.subject}" ≠ subject du config "${q.subject}"`);
    if (r.data && r.data.title && q.title && r.data.title !== q.title)
      warn(q.file, `titre du fichier "${r.data.title}" ≠ titre du config "${q.title}"`);
  });

  // --- service worker (avertissement seulement) ---
  if (fs.existsSync(SW_PATH)) {
    const sw = fs.readFileSync(SW_PATH, "utf8");
    registeredFiles.forEach((f) => {
      if (!sw.includes(f))
        warn(f, "absent de STATIC_ASSETS dans service-worker.js → lancer: bash scripts/generate-sw.sh");
    });
  }

  report();
}

function report() {
  console.log("=== Validation des questionnaires ===\n");
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} avertissement(s):`);
    warnings.forEach((w) => console.log(`  ⚠ [${w.file}] ${w.msg}`));
    console.log("");
  }
  if (errors.length) {
    console.log(`✘ ${errors.length} erreur(s):`);
    errors.forEach((e) => console.log(`  ✘ [${e.file}] ${e.msg}`));
    console.log("\nValidation ÉCHOUÉE.");
    process.exit(1);
  }
  console.log("✔ Tous les questionnaires respectent le format. Validation OK.");
  process.exit(0);
}

main();
