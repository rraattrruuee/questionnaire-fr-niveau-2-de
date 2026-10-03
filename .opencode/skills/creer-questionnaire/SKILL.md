---
name: creer-questionnaire
description: Créer ou étendre un questionnaire dans ce projet PWA (questionnaire-fr--niveau-2-de). À utiliser systématiquement quand l'utilisateur demande de créer un nouveau questionnaire, d'ajouter des questions à un quiz existant, de corriger un JSON de quiz, ou d'ajouter une matière. Couvre le format JSON, data/config.json, la validation, le service worker et les tests navigateur.
---

# Créer un questionnaire dans ce projet

## 1. Vue d'ensemble du projet

- **Repo** : `questionnaire-fr--niveau-2-de` (GitHub Pages, branche `main`)
- **URL publiée** : `https://rraattrruuee.github.io/questionnaire-fr-niveau-2-de/`
- **Moteur** : `js/quiz.js` (portail = `index.html` + `js/portal.js`, quiz = `quiz.html`)
- **Config** : `data/config.json` (source de vérité : subjects + quizzes)
- **Stockage** : chaque quiz = 1 fichier JSON dans `data/<matiere>/<slug>.json`
- **Cache** : `service-worker.js` régénéré par `bash scripts/generate-sw.sh`
- **Validation CI** : `node scripts/validate-quizzes.js` (workflow `.github/workflows/validate-quizzes.yml` + étape bloquante du déploiement `static.yml`)

**Règle d'or** : l'utilisateur commit/push lui-même. Ne jamais `git commit`/`git push` sans demande explicite. En fin de tâche, lister les fichiers à committer.

## 2. Workflow en 9 étapes

1. **Date exacte** : **avant toute chose**, exécuter `date +%F` dans le terminal pour obtenir la date réelle du jour (format `AAAA-MM-JJ`). Ne **jamais** supposer la date (la date de la session/contexte peut être fausse). Conserver la valeur pour le champ `added` de l'étape 3.
2. **Collecte du cours** : l'utilisateur fournit le matériau. Questions **autonomes** (jamais besoin du texte/contexte du cours — voir §9 « Autonomie stricte »).
3. **Choix des métadonnées** : `id` (slug ASCII), `title`, `subject` (doit exister dans `config.subjects`), `file` = `data/<matiere>/<slug>.json`, `questionsCount`, `description`, `tags`, `added` = **sortie de `date +%F`**.
4. **Génération** : écrire un script Python dans `/tmp/opencode/make_*.py` qui construit le dict et écrit le JSON (`ensure_ascii=False, indent=2`). Ne jamais écrire le JSON à la main.
5. **Enregistrement** : ajouter l'entrée dans `data/config.json` (dans `quizzes`). Si la matière n'existe pas, l'ajouter d'abord dans `subjects` (id ASCII, name, icon emoji, color hex, description).
6. **Validation** : `node scripts/validate-quizzes.js` → doit afficher `✔ ... Validation OK.` (0 erreur).
7. **Service worker** : `bash scripts/generate-sw.sh` (met à jour la liste des assets + horodatage `CACHE_NAME`).
8. **Tests** : `node --check js/quiz.js && node --check js/portal.js`, puis test navigateur headless (voir §7).
9. **Rapport** : tableau des catégories + nb de questions + liste des fichiers à committer.

## 3. Format JSON d'un questionnaire (schéma exact)

```json
{
  "subject": "physique-chimie",
  "title": "Titre du quiz",
  "description": "Description en une ligne.",
  "css": "optionnel : CSS custom appliqué au quiz",
  "notepad": false,
  "categories": [
    {
      "category": "Nom de la catégorie",
      "notepad": true,
      "questions": [
        {
          "text": "Énoncé (HTML autorisé : <sup>, fractions…)",
          "type": "mcq",
          "options": ["choix 1", "choix 2", "choix 3", "choix 4"],
          "correct": 0,
          "solution": "Explication affichée après réponse (OBLIGATOIRE)",
          "image": "optionnel : chemin image"
        },
        {
          "text": "Question à réponse libre",
          "type": "text",
          "options": [],
          "correct": 0,
          "accepted": ["variante1", "variante2"],
          "solution": "Explication"
        }
      ]
    }
  ]
}
```

### Règles non négociables (les pièges les plus fréquents)

| Règle | Détail |
|---|---|
| **`correct` = entier index 0-based** | JAMAIS un string. `correct: 0` = premier élément de `options`. Erreur historique réelle du projet. |
| **`options` sans doublon** | `new Set(options).size === options.length`. Une option dupliquée = ambiguïté. |
| **≥ 2 options** pour mcq | 4 recommandé (2 accepté par le validateur). |
| **`solution` obligatoire** | String non vide, sur TOUTES les questions. |
| **`type`** | `"mcq"` ou `"text"` (défaut mcq). |
| **`accepted`** | Obligatoire si `type: "text"` : tableau de strings non vide. Comparaison insensible à la casse/espaces/virgules. |
| **Texte en doublon interdit** | Deux questions ne peuvent pas avoir le même `text` dans un quiz. |
| **`category` unique** | Pas de doublon de nom de catégorie dans un quiz. |
| **`subject` = ID** | Le `subject` du fichier doit être l'**ID** de `config.subjects` (`francais`, pas `Francais`). |
| **`title` aligné** | Le `title` du fichier doit être identique à celui de `config.json`. |
| **Questions autonomes** | Une question doit être répondable seule à l'écran. Jamais de référence à un contenu non joint (image absente, extrait non recopié, question précédente). Voir §9. |
| **UTF-8 sans escape** | `json.dump(..., ensure_ascii=False, indent=2)`. |
| **ASCII pour les IDs** | `id` et `file` sans accents/espaces. |

## 4. Structure du script générateur type

```python
# /tmp/opencode/make_<slug>.py
import json, os

def Q(text, options, correct, solution, typ="mcq"):
    return {"text": text, "type": typ, "options": options,
            "correct": correct, "solution": solution}

def VF(text, is_true, solution):
    opts = ["Vrai", "Faux"] if is_true else ["Faux", "Vrai"]
    return {"text": text, "type": "mcq", "options": opts,
            "correct": 0, "solution": solution}

def TXT(text, accepted, solution):
    return {"text": text, "type": "text", "options": [], "correct": 0,
            "accepted": accepted, "solution": solution}

categories = [{"category": "...", "questions": [ ... ]}]

quiz = {"subject": "<id>", "title": "...", "description": "...",
        "categories": categories}

# Validation AVANT écriture
for c in quiz["categories"]:
    for q in c["questions"]:
        if q["type"] == "mcq":
            assert isinstance(q["correct"], int) and 0 <= q["correct"] < len(q["options"])
            assert len(set(q["options"])) == len(q["options"]), "DUP: " + q["text"]
            assert q["solution"]
        else:
            assert q.get("accepted")

out = "data/<matiere>/<slug>.json"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump(quiz, f, ensure_ascii=False, indent=2)

total = sum(len(c["questions"]) for c in quiz["categories"])
print(f"Total: {total} questions, {len(quiz['categories'])} categories")
for c in quiz["categories"]:
    print(f"  {c['category']}: {len(c['questions'])}q")
```

## 5. Ajouter des questions à un quiz existant

```python
import json
fp = "data/<matiere>/<slug>.json"
with open(fp) as f:
    quiz = json.load(f)
quiz["categories"].append({"category": "Nouvelle catégorie", "questions": [...]})
# OU modifier une catégorie existante
total = sum(len(c["questions"]) for c in quiz["categories"])
# revalididentique (assert ci-dessus), réécrire le fichier,
# puis METTRE À JOUR questionsCount dans data/config.json (= total exact)
```

**Oublier `questionsCount`** = échec de la validation CI (le déploiement échoue aussi).

## 6. Validation locale (obligatoire avant de rendre la main)

```bash
node scripts/validate-quizzes.js   # doit dire "✔ ... Validation OK."
bash scripts/generate-sw.sh
node --check js/quiz.js && node --check js/portal.js
```

Le validateur vérifie :
1. JSON bien formé + schéma (categories/questions/subject/title/description)
2. mcq : options uniques, ≥ 2, `correct` entier dans les bornes
3. text : `accepted` non vide
4. `solution` non vide partout
5. tout fichier `data/**/*.json` (hors config) référencé dans `config.json` → sinon *orphelin*
6. tout fichier du config existe sur disque
7. `questionsCount` = nombre réel ; `subject` du fichier = `subject` du config
8. pas de doublon d'`id`/`file`/texte de question/nom de catégorie
9. `added` au format `AAAA-MM-JJ`
10. (avertissement) fichier présent dans `STATIC_ASSETS` de `service-worker.js`

**Le workflow `validate-quizzes.yml`** tourne à chaque push/PR touchant `data/**`. **L'étape de validation de `static.yml` bloque le déploiement Pages** si invalide.

## 7. Test navigateur (headless)

```bash
# serveur local
setsid bash run.sh 8185 --no-open < /dev/null > /tmp/opencode/srv.log 2>&1 & disown
sleep 3

# chargement du quiz + recherche d'erreurs JS
chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --user-data-dir=/tmp/opencode/chrome-t --virtual-time-budget=12000 \
  --dump-dom 'http://localhost:8185/quiz.html?id=<quiz-id>' 2>/dev/null \
  | grep -oiE '(error|exception)' | sort | uniq -c
# → 0 ligne = 0 erreur ; vérifier aussi que les noms de catégories apparaissent

pkill -f 'run[.]sh 8185'; pkill -9 -f 'chrom[i]um'
```

### Test interactif (CDP) — pour cliquer/répondre

```bash
nohup chromium --headless=new --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/opencode/cdp --remote-debugging-port=9227 \
  --remote-allow-origins='*' about:blank > /tmp/opencode/cdp.log 2>&1 < /dev/null &
# puis script Python avec websocket-client : Page.navigate, Runtime.evaluate
```

**Pièges connus** :
- Ne **jamais** nommer un script `/tmp/opencode/inspect.py` → masque la stdlib `inspect`, casse l'import `websocket`.
- `pkill -f <pattern>` dans le même shell que la commande contenant le pattern tue son propre shell → utiliser des motifs avec crochets : `chrom[i]um`, `run[.]sh`.
- Les scripts CDP peuvent parfois pendre/timeout : préférer `--dump-dom` + grep comme test minimal.

## 8. Checklist finale (à présenter à l'utilisateur)

- [ ] **`date +%F` exécuté** et sa sortie exacte utilisée pour `added`
- [ ] Chaque question testée « seule à l'écran » : répondable sans aucun contenu externe non joint
- [ ] Fichier JSON créé dans `data/<matiere>/`, UTF-8, `indent=2`
- [ ] Entrée ajoutée à `data/config.json` (`quizzes`) avec `questionsCount` exact
- [ ] Matière présente dans `config.subjects` (sinon ajoutée)
- [ ] `node scripts/validate-quizzes.js` → `✔ Validation OK.`
- [ ] `bash scripts/generate-sw.sh` exécuté
- [ ] `node --check` sur `js/*.js` OK
- [ ] Test headless : 0 erreur, catégories affichées
- [ ] **Liste des fichiers à committer remise à l'utilisateur** (jamais de push non demandé)

## 9. Conventions de contenu

- **Langue** : questions/réponses en français (sauf matières vivantes : anglais, italien…).
- **Autonomie stricte** : une question ne doit **jamais** dépendre d'un contenu non fourni dans son propre énoncé. Le lecteur ne dispose que de la question affichée à l'écran — rien d'autre.
  - **Interdit** : question portant sur un visuel absent (ex. « Quelle est la couleur du pantalon ? » **sans** image du pantalon dans la question), sur un extrait de texte/cours pas recopié dans l'énoncé, sur un son/vidéo absent, ou sur une question précédente (« la question ci-dessus… »).
  - **Obligatoire** : si la question porte sur un document (image, tableau, texte, graphique), il **doit** être joint à la question via le champ `"image"` (chemin réel du repo) ou recopié intégralement dans `text` (tableau en HTML, extrait entre guillemets…).
  - **Sans document** : poser une question de **connaissance générale du cours** formulée de façon totalement autonome (définition, propriété, valeur, calcul, raisonnement) — jamais de référence à « l'exemple ci-joint », « le schéma », « le texte ».
  - Test final avant livraison : masquer tout sauf une question → doit-elle être répondable seule ? Si non, la réécrire ou joindre le document.
- **Diversité** : mélanger QCM, Vrai/Faux (`VF`), texte libre (`TXT`), avec chiffres exacts du cours.
- **Catégories** : thématically regroupées, 10–30 questions par catégorie (30 max conseillé).
- **Exercices pratiques** : si demandé, les placer en **dernière catégorie** et activer `"notepad": true` sur elle (brouillon de calcul, jamais affiché comme réglage).
- **`added`** : exécuter `date +%F` dans le terminal **avant** de remplir le champ, et utiliser **la sortie exacte de cette commande** (ne jamais deviner la date). Cette date déclenche le badge « Nouveau » (30 jours) et le tri « ✨ Nouveautés ».
  ```bash
  date +%F   # ex. 2026-10-03  →  "added": "2026-10-03"
  ```
