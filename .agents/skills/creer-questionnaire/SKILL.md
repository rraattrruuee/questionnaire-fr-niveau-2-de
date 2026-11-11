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
- **Helper de génération** : `scripts/quiz_lib.py` (`Q`, `VF`, `TXT`, `write_quiz`) — convertit automatiquement `correct` (texte → index) et refuse les formats invalides
- **Réparateur** : `node scripts/fix-quiz-format.js` (ajouter `--check` pour la CI / le hook)
- **Hook pre-commit** : `.githooks/pre-commit` (installé via `bash scripts/install-hooks.sh`) — bloque tout commit de questionnaire mal formé

**Règle d'or** : l'utilisateur commit/push lui-même. Ne jamais `git commit`/`git push` sans demande explicite. En fin de tâche, lister les fichiers à committer.

## 2. Workflow en 9 étapes

1. **Date exacte** : **avant toute chose**, exécuter `date +%F` dans le terminal pour obtenir la date réelle du jour (format `AAAA-MM-JJ`). Ne **jamais** supposer la date (la date de la session/contexte peut être fausse). Conserver la valeur pour le champ `added` de l'étape 3.
2. **Collecte du cours** : l'utilisateur fournit le matériau. Questions **autonomes** (jamais besoin du texte/contexte du cours — voir §9 « Autonomie stricte »).
3. **Choix des métadonnées** : `id` (slug ASCII), `title`, `subject` (doit exister dans `config.subjects`), `file` = `data/<matiere>/<slug>.json`, `questionsCount`, `description`, `tags`, `added` = **sortie de `date +%F`**.
4. **Génération** : écrire un script Python dans `/tmp/opencode/make_*.py` qui **importe `scripts/quiz_lib.py`** et utilise `Q()/VF()/TXT()`, puis `write_quiz()`. `Q()` accepte `correct` en entier **ou** en texte d'option et le convertit en index : c'est la protection anti-erreur. Ne jamais écrire le JSON à la main.
5. **Enregistrement** : ajouter l'entrée dans `data/config.json` (dans `quizzes`). Si la matière n'existe pas, l'ajouter d'abord dans `subjects` (id ASCII, name, icon emoji, color hex, description).
6. **Validation** : `node scripts/fix-quiz-format.js --check && node scripts/validate-quizzes.js` → doit afficher `✔ ... Validation OK.` (0 erreur). En cas d'erreur `correct`, lancer `node scripts/fix-quiz-format.js` pour réparer automatiquement.
7. **Service worker** : `bash scripts/generate-sw.sh` (met à jour la liste des assets + horodatage `CACHE_NAME`). Le script **revalide les questionnaires** et refuse de continuer si l'un est invalide.
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
| **`correct` = entier index 0-based** | JAMAIS un string dans le JSON final. `correct: 0` = premier élément de `options`. Erreur historique réelle du projet. Avec `quiz_lib.Q()`, on peut passer le **texte** de la bonne réponse : il est converti automatiquement en index. Réparation : `node scripts/fix-quiz-format.js`. |
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
| **Longueur homogène des options** | Pour chaque question QCM, toutes les options de réponse (`options`) doivent avoir **approximativement la même longueur** (nombre de caractères comparable) et le même degré de précision/détail. Interdit d'avoir une bonne réponse 2 ou 3 fois plus longue, plus complète ou plus développée que les distracteurs (ou inversement), car cela donne un indice visuel immédiat qui fausse l'évaluation. |
| **UTF-8 sans escape** | `json.dump(..., ensure_ascii=False, indent=2)`. |
| **ASCII pour les IDs** | `id` et `file` sans accents/espaces. |

## 4. Structure du script générateur type (OBLIGATOIRE)

Utiliser le helper du projet. Il garantit un `correct` entier et valide tout
avant écriture : impossible de produire un JSON mal formé.

```python
# /tmp/opencode/make_<slug>.py
import sys
sys.path.insert(0, "scripts")
from quiz_lib import Q, VF, TXT, write_quiz

categories = [
    {
        "category": "Nom de la catégorie",
        "questions": [
            # correct = index entier (0 = 1re option) OU texte de la bonne réponse.
            # Les deux sont acceptés ; le texte est converti en index automatiquement.
            Q("Capitale de l'Italie ?",
              ["Rome", "Paris", "Madrid", "Berlin"],
              "Rome",                      # <- converti en 0
              "Rome est la capitale de l'Italie."),
            Q("2 + 2 = ?", ["3", "4", "5", "6"], 1, "4"),
            VF("476 = chute de l'Empire romain d'Occident.", True, "Oui, en 476."),
            TXT("Quel fleuve traverse Paris ?", ["Seine", "la Seine"], "La Seine."),
        ],
    },
]

quiz = {
    "subject": "<id>",              # ID exact de config.subjects
    "title": "...",                 # identique au title de config.json
    "description": "...",
    "categories": categories,
}

write_quiz(quiz, "data/<matiere>/<slug>.json")   # valide + écrit (UTF-8, indent=2)
```

> **Ne pas** réimplémenter `Q()`/`VF()`/`TXT()` à la main : c'est précisément
> comme ça que l'erreur `correct` en chaîne est apparue. Le helper lève une
> erreur explicite si la réponse n'existe pas dans `options` ou si les options
> sont dupliquées.

## 5. Ajouter des questions à un quiz existant

```python
import json, sys
sys.path.insert(0, "scripts")
from quiz_lib import Q, write_quiz

fp = "data/<matiere>/<slug>.json"
with open(fp, encoding="utf-8") as f:
    quiz = json.load(f)

quiz["categories"].append({
    "category": "Nouvelle catégorie",
    "questions": [
        Q("Question ?", ["A", "B", "C", "D"], "B", "Explication."),  # "B" -> index 1
    ],
})

write_quiz(quiz, fp)   # revalide tout et réécrit proprement
```

Ensuite **mettre à jour `questionsCount`** dans `data/config.json` (= total exact
renvoyé par `write_quiz`).

**Oublier `questionsCount`** = échec de la validation CI (le déploiement échoue aussi).

## 6. Validation locale (obligatoire avant de rendre la main)

```bash
node scripts/fix-quiz-format.js --check   # "correct" = entier partout
node scripts/validate-quizzes.js          # doit dire "✔ ... Validation OK."
bash scripts/generate-sw.sh
node --check js/quiz.js && node --check js/portal.js
```

Si `fix-quiz-format.js --check` signale des erreurs :
```bash
node scripts/fix-quiz-format.js           # répare automatiquement (texte -> index)
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
- [ ] `node scripts/fix-quiz-format.js --check` → `✔ Format OK`
- [ ] `node scripts/validate-quizzes.js` → `✔ Validation OK.`
- [ ] `bash scripts/generate-sw.sh` exécuté (revalide et refuse si invalide)
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
- **Longueur homogène des réponses (anti-indice)** : Pour chaque question QCM, veiller à ce que toutes les options de réponse fassent approximativement la même longueur (nombre de caractères similaire) et partagent un niveau de détail comparable. Les élèves repèrent instantanément la « bonne » réponse si elle est la seule à être rédigée avec une phrase complète, des explications riches ou des nuances alors que les distracteurs ne font que 3 mots. Rédiger les mauvaises réponses avec la même richesse de vocabulaire et la même longueur que la bonne réponse.
- **Catégories** : thématically regroupées, 10–30 questions par catégorie (30 max conseillé).
- **Exercices pratiques** : si demandé, les placer en **dernière catégorie** et activer `"notepad": true` sur elle (brouillon de calcul, jamais affiché comme réglage).
- **`added`** : exécuter `date +%F` dans le terminal **avant** de remplir le champ, et utiliser **la sortie exacte de cette commande** (ne jamais deviner la date). Cette date déclenche le badge « Nouveau » (30 jours) et le tri « ✨ Nouveautés ».
  ```bash
  date +%F   # ex. 2026-10-03  →  "added": "2026-10-03"
  ```

## 10. Anti-régression : le format `correct`

**Symptôme** : la CI échoue avec
`"correct" doit être un ENTIER = index 0-based dans "options" (reçu: "...")`.

**Cause** : une question QCM a été écrite avec la chaîne de la bonne réponse
au lieu de son index.

**Chaîne de protections mise en place** (dans l'ordre où elles s'appliquent) :

1. **Génération** — `scripts/quiz_lib.py` : `Q(..., "Rome", ...)` convertit en
   index et lève une erreur si la réponse n'est pas dans `options`. Impossible
   d'écrire un `correct` chaîne via le helper.
2. **Avant commit** — hook `.githooks/pre-commit` : exécute
   `node scripts/fix-quiz-format.js --check` puis
   `node scripts/validate-quizzes.js`. Un commit invalide est bloqué.
   Installation locale : `bash scripts/install-hooks.sh` (fait une fois par clone).
3. **Avant déploiement** — `bash scripts/generate-sw.sh` revalide et refuse de
   régénérer le service worker si un questionnaire est invalide
   (contournement exceptionnel : `SKIP_VALIDATE=1`).
4. **CI** — `.github/workflows/validate-quizzes.yml` exécute
   `fix-quiz-format.js --check` **puis** `validate-quizzes.js`. L'étape de
   `static.yml` bloque aussi le déploiement Pages.
5. **Réparation auto** — `node scripts/fix-quiz-format.js` corrige les fichiers
   existants (texte → index), sans toucher au contenu.

**Règle absolue** : ne jamais réimplémenter `Q()`/`VF()`/`TXT()` à la main dans
un script `/tmp/opencode/make_*.py`. Toujours importer `scripts/quiz_lib.py`.

## 11. Graphiques et schémas vectoriels SVG

Quand un cours comporte des schémas conceptuels, des expériences, des modèles, des organigrammes ou des graphiques méthodologiques (SVT, SES, Physique-Chimie, Histoire-Géo, Maths, etc.), créer des fichiers SVG dédiés sur mesure pour illustrer les questions.

### Bonnes pratiques SVG du projet :
1. **Emplacement** : ranger les fichiers dans `assets/images/<matiere>/<nom-du-schema>.svg` (ex. `assets/images/ses/schema-socialisation-bourdieu.svg`).
2. **Attributs racines** : toujours inclure `viewBox="0 0 L H"`, `width="100%"` et `height="100%"` pour garantir une adaptabilité responsive fluide sur smartphone comme sur grand écran.
3. **Typographie** : utiliser `font-family="system-ui, -apple-system, sans-serif"`, avec des tailles de texte adaptées et lisibles (10px à 18px).
4. **Contraste et esthétique** : adopter un fond soigné (`#0f172a` ou dégradé `#0b1329` vers `#1e293b`) avec cadre (`#334155`), des textes nets (`#f8fafc`, `#cbd5e1`) et des couleurs thématiques franches (`#38bdf8`, `#10b981`, `#f59e0b`, `#ef4444`, `#a855f7`).
5. **Association dans le questionnaire** :
   Dans le script Python :
   ```python
   Q("En observant le schéma ci-dessous, quelle est...",
     ["Option A", "Option B", "Option C", "Option D"],
     "Option A",
     "Explication...",
     image="assets/images/<matiere>/mon-schema.svg")
   ```
6. **Mise en cache PWA automatique** :
   Le script `bash scripts/generate-sw.sh` scanne récursivement tous les fichiers `.svg` sous `assets/` et les ajoute à `STATIC_ASSETS` dans `service-worker.js`.
