#!/usr/bin/env node
/* ============================================================
   fix-quiz-format.js

   Répare le format des questionnaires sans toucher au contenu :

     - `correct` (QCM) écrit comme CHAÎNE → converti en index 0-based
       dans `options` (si la chaîne correspond exactement à une option) ;
     - `correct` écrit comme chaîne numérique ("0") → converti en entier ;
     - signale toute valeur impossible à réparer automatiquement.

   Usage :
     node scripts/fix-quiz-format.js           # corrige et réécrit les fichiers
     node scripts/fix-quiz-format.js --check   # ne modifie rien ; code 1 si problème
     node scripts/fix-quiz-format.js --verbose # détail des corrections

   Utilisé par le hook pre-commit (.githooks/pre-commit) et disponible pour la CI.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const VERBOSE = args.includes("--verbose");

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

function resolveCorrect(options, correct) {
  if (typeof correct === "number" && Number.isInteger(correct)) {
    return Number.isInteger(correct) && correct >= 0 && correct < options.length
      ? { value: correct }
      : { error: `index ${correct} hors bornes [0..${options.length - 1}]` };
  }
  if (typeof correct === "string") {
    const exact = [];
    options.forEach((o, i) => {
      if (o === correct) exact.push(i);
    });
    if (exact.length === 1) return { value: exact[0], converted: true };
    if (exact.length > 1)
      return { error: `"${correct}" correspond à plusieurs options (index ${exact.join(", ")})` };
    // Chaîne numérique éventuelle ("0", "1", ...)
    if (/^\d+$/.test(correct.trim())) {
      const n = Number(correct.trim());
      return n >= 0 && n < options.length
        ? { value: n, converted: true }
        : { error: `chaîne numérique "${correct}" hors bornes` };
    }
    return { error: `"${correct}" n'apparaît dans aucune option` };
  }
  return { error: `type ${typeof correct} non supporté (${JSON.stringify(correct)})` };
}

const files = walkJson(DATA_DIR).filter((p) => rel(p) !== "data/config.json");
let changedFiles = 0;
let changedQuestions = 0;
const problems = [];

for (const file of files) {
  let quiz;
  try {
    quiz = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    problems.push({ file: rel(file), msg: `JSON invalide : ${e.message}` });
    continue;
  }
  if (!quiz || !Array.isArray(quiz.categories)) continue;

  let fileChanged = false;
  quiz.categories.forEach((cat, ci) => {
    if (!cat || !Array.isArray(cat.questions)) return;
    cat.questions.forEach((q, qi) => {
      if (!q || (q.type !== undefined && q.type !== "mcq")) return;
      if (!Array.isArray(q.options)) return;
      const r = resolveCorrect(q.options, q.correct);
      if (r.error) {
        problems.push({
          file: rel(file),
          msg: `categories[${ci}].questions[${qi}] : ${r.error}`,
        });
        return;
      }
      if (r.converted) {
        if (VERBOSE) {
          console.log(
            `  ~ ${rel(file)} cat[${ci}].q[${qi}] : ${JSON.stringify(q.correct)} -> ${r.value}`
          );
        }
        q.correct = r.value;
        fileChanged = true;
        changedQuestions++;
      }
    });
  });

  if (fileChanged) {
    changedFiles++;
    if (!CHECK) {
      fs.writeFileSync(file, JSON.stringify(quiz, null, 2) + "\n", "utf8");
    }
  }
}

console.log("=== Format des questionnaires (correct = index) ===");
if (problems.length) {
  console.log(`✘ ${problems.length} problème(s) non réparable(s) automatiquement :`);
  problems.forEach((p) => console.log(`  ✘ [${p.file}] ${p.msg}`));
}
if (changedQuestions) {
  if (CHECK) {
    console.log(
      `✘ ${changedQuestions} question(s) dans ${changedFiles} fichier(s) ont "correct" en chaîne.` +
        `\n  → corriger avec : node scripts/fix-quiz-format.js`
    );
  } else {
    console.log(`✅ ${changedQuestions} question(s) corrigée(s) dans ${changedFiles} fichier(s).`);
  }
}
if (!problems.length && !changedQuestions) {
  console.log("✔ Format OK : tous les \"correct\" sont des entiers.");
}

process.exit(problems.length || (CHECK && changedQuestions) ? 1 : 0);
