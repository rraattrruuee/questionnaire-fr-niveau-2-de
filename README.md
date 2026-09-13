# Questionnaires 2nde

[![Deploy](https://github.com/rraattrruuee/questionnaire-fr-niveau-2-de/actions/workflows/static.yml/badge.svg)](https://github.com/rraattrruuee/questionnaire-fr-niveau-2-de/actions/workflows/static.yml)
[![PWA Status](https://img.shields.io/badge/PWA-Ready-green.svg)](https://rraattrruuee.github.io/questionnaire-fr-niveau-2-de/)

Portail de questionnaires interactifs pour le niveau **Seconde**. Architecture JSON-driven : ajoutez des quiz en ajoutant des fichiers JSON, sans toucher au code.

**Acces :** [**https://rraattrruuee.github.io/questionnaire-fr-niveau-2-de/**](https://rraattrruuee.github.io/questionnaire-fr-niveau-2-de/)

---

## Matieres

| Matiere | Icone |
|---|---|
| Francais | 🇫🇷 |
| Anglais | 🇬🇧 |
| Italien | 🇮🇹 |
| Sciences Economiques & Sociales | 📊 |
| Histoire-Geographie | 📜 |
| Enseignement Moral & Civique | ⚖️ |
| Mathematiques | 🔢 |
| Sciences Numeriques & Technologie | 💻 |
| Physique-Chimie | ⚛️ |
| Sciences de la Vie & de la Terre | 🌱 |

---

## Outils inclus

| Outil | Description |
|---|---|
| ⚡ **QuizMaster Dynamique** | Generateur et importateur de questionnaires : generez via IA, importez des JSON, testez et exportez en HTML autonome |

---

## Architecture

```
questionnaire-fr-niveau-2-de/
├── index.html              ← Portail dynamique
├── quiz.html               ← Moteur de quiz (charge depuis JSON)
├── quizmaster.html         ← Generateur & importateur de questionnaires
├── run.sh                  ← Serveur local de test (./run.sh)
├── css/
│   ├── theme.css           ← Tokens & composants partages (clair/sombre)
│   ├── portal.css          ← Styles du portail
│   └── quiz.css            ← Styles du moteur de quiz
├── js/
│   ├── portal.js           ← Logique du portail (filtres, recherche)
│   ├── quiz.js             ← Moteur de quiz (shuffle, feedback, resultats)
│   └── theme.js            ← Gestion du theme clair/sombre (auto + toggle)
├── data/
│   ├── config.json         ← Config centralisee (sujets, quiz, outils)
│   ├── francais/
│   ├── anglais/
│   ├── italien/
│   ├── ses/
│   ├── histoire-geo/
│   ├── emc/
│   ├── mathematiques/
│   ├── snat/
│   ├── physique-chimie/
│   └── svt/
├── scripts/
│   └── generate-sw.sh      ← Script d'auto-generation du service worker
├── manifest.json           ← PWA manifest
├── service-worker.js       ← Cache offline (auto-genere)
└── offline.html            ← Page hors-ligne
```

---

## Ajouter un quiz

### 1. Creer le fichier JSON

Dans `data/<matiere>/mon-quiz.json` :

```json
{
  "id": "mon-quiz-id",
  "title": "Titre du Quiz",
  "subject": "emc",
  "questions": [
    {
      "q": "Question ?",
      "answers": ["Choix A", "Choix B", "Choix C", "Choix D"],
      "correct": "Choix A"
    }
  ]
}
```

> Pas envie d'ecrire le JSON a la main ? Voir la section
> [**Generer des questions avec une IA**](#generer-des-questions-avec-une-ia) :
> deux prompts complets produisent le fichier entier.

### 2. Ajouter l'entree dans `data/config.json`

```json
{
  "quizzes": [
    {
      "id": "mon-quiz-id",
      "title": "Titre du Quiz",
      "subject": "emc",
      "file": "data/emc/mon-quiz.json",
      "questionsCount": 50,
      "description": "Description du quiz",
      "tags": ["revision"],
      "added": "2026-09-12"
    }
  ]
}
```

C'est tout. Le portail et le moteur de quiz se chargent automatiquement.

### Nouveautes (automatique)

Le portail affiche **tout en haut** un onglet **« ✨ Nouveautés »**
avec les **4 derniers questionnaires ajoutés**. C'est **automatique** :

- Un quiz avec un champ **`"added": "AAAA-MM-JJ"`** est daté et classé selon cette date.
- Sans champ `added`, l'**ordre dans le tableau `quizzes`** fait foi : le dernier
  est le plus récent.

> Donc pour publier un nouveau quiz, il suffit de l'**ajouter à la fin** du
> tableau `quizzes` (ou de renseigner `added`). L'onglet se met à jour tout seul.
> Les quiz datés de **moins de 30 jours** reçoivent aussi un badge **« Nouveau »**
> dans les listes par matière.

> **Vous ne voyez pas la nouveauté ?** Le service worker met en cache les
> fichiers. La strategie est desormais **network-first** (derniere version en
> ligne, repli hors-ligne), donc une simple actualisation suffit. En cas de doute :
> **Ctrl+Shift+R**.

### Format avance (categories, types, explications, images)

Un fichier quiz peut contenir plusieurs **categories** et deux types de questions
(`mcq` et `text`), avec **explication** (`solution`) et **image**. Le HTML est
rendu (puissances, fractions, etc.).

```json
{
  "subject": "Mathematiques",
  "title": "Algebre",
  "description": "Calcul litteral",
  "css": ".important { color:#f59e0b; font-weight:900; }",
  "categories": [
    {
      "category": "1. Equations",
      "questions": [
        {
          "text": "Combien vaut <div class='math-frac'><span class='math-num'>1</span><span class='math-den'>2</span></div> + 1 ?",
          "type": "mcq",
          "options": ["1,5", "2", "0,5"],
          "correct": 0,
          "solution": "0,5 + 1 = 1,5.",
          "image": "data:image/png;base64,..."
        },
        {
          "text": "Donne x si 2x = 10.",
          "type": "text",
          "accepted": ["5", "x=5"],
          "solution": "x = 10 / 2 = 5."
        }
      ]
    }
  ]
}
```

- `type: "mcq"` : `options` = liste des choix, `correct` = index (0 = 1er choix).
- `type: "text"` : `accepted` = reponses acceptees (comparaison insensible aux
  espaces, virgules et majuscules).
- `solution` : explication affichee apres validation.
- `image` : URL ou base64, affichee au-dessus des reponses.

Si plusieurs categories sont presentes, un **menu de categories** s'affiche avant
le quiz. Un simple tableau plat de questions fonctionne aussi.

### Fractions mathematiques

```html
<div class='math-frac'><span class='math-num'>NUMERATEUR</span><span class='math-den'>DENOMINATEUR</span></div>
```

Puissances : `x<sup>2</sup>` — Multiplication : `×` (pas `*`).

### Styles et animations

- Le `text` d'une question accepte du **HTML** : balises, classes et styles en
  ligne. Ex : `<span class='important'>mot cle</span>` ou
  `<span style='color:#f59e0b'>Important</span>`.
- Un quiz peut definir sa propre feuille de style via le champ **`css`** (injecte
  automatiquement a l'ouverture du quiz) :

```json
{
  "title": "Mon quiz",
  "css": ".important { color:#f59e0b; font-weight:900; }",
  "questions": [
    { "q": "Question <span class='important'>cle</span> ?", "answers": ["A", "B"], "correct": "A" }
  ]
}
```

- Classes d'animation deja fournies (utilisables dans `text` ou `css`) :
  `.couleur-qui-change` (couleur qui defile), `.clignotant` (clignote),
  `.anim-border-fade` (bordure animee).
- Les entrees/sorties des questions sont **synchronisees** : la carte de la
  question et le bloc de feedback apparaissent et disparaissent **ensemble**
  (bonne reponse : surbrillance verte + leger zoom ; mauvaise reponse : secousse
  rouge). Plus d'elements qui disparaissent les uns avant les autres.

> Exemples complets et fonctionnels :
> [`data/italien/presentare-una-persona.json`](data/italien/presentare-una-persona.json)
> (84 questions, 5 categories) et
> [`data/francais/outils-analyse-litteraire.json`](data/francais/outils-analyse-litteraire.json)
> (195 questions, 8 categories : registres, figures de style, phrase, recit,
> genres et courants litteraires).

---

## QuizMaster Dynamique

Outil de generation et d'importation de questionnaires :

1. **Prompt IA** : Copiez le prompt genere et utilisez-le avec une IA pour generer des questions au format JSON
2. **Importer** : Chargez un fichier JSON ou collez le code directement
3. **Tester** : Le quiz se lance automatiquement pour tester les questions
4. **Exporter** : Exportez en fichier HTML autonome partageable

---

## Theme Sombre / Clair

Le site detecte automatiquement le theme du systeme (`prefers-color-scheme`) et propose un bouton basculer dans la barre de navigation. Le choix est sauvegarde dans `localStorage`.

---

## Generer des questions avec une IA

Cette section explique **comment le moteur fonctionne**, puis fournit **2 prompts
complets** (QCM general et QCM de mathematiques). Chaque prompt produit **le
fichier JSON entier** : il ne reste qu'a l'enregistrer puis a le declarer.

### Comment fonctionne le moteur (a comprendre avant de generer)

- Le portail lit `data/config.json` pour connaitre la liste des quiz.
- Chaque quiz pointe vers un **fichier JSON** (`"file"`).
- Pour un fichier, le moteur :
  - affiche un **menu de categories** s'il y en a plusieurs ;
  - **melange** les questions et les choix de reponses ;
  - pour `mcq` : affiche des boutons, une seule bonne reponse (par **index**) ;
  - pour `text` : affiche un champ de saisie, compare aux reponses `accepted` ;
  - affiche la **`solution`** apres chaque reponse ;
  - calcule le score, la progression et propose de recommencer.

Structure attendue d'un fichier :

```
{
  "subject":   "Nom de la matiere",
  "title":     "Titre du questionnaire",
  "description": "Courte description",
  "categories": [
    {
      "category": "Nom de la categorie",
      "questions": [
        { "text": "...", "type": "mcq",  "options": ["A","B","C"], "correct": 0, "solution": "..." },
        { "text": "...", "type": "text", "accepted": ["rep1","rep2"], "solution": "..." }
      ]
    }
  ]
}
```

| Cle | Role |
|---|---|
| `type: "mcq"` | `options` = choix ; `correct` = **index** (0 = premier choix) |
| `type: "text"` | `accepted` = **liste** de toutes les reponses acceptees |
| `solution` | Explication affichee apres la reponse |
| `image` | (Facultatif) URL ou base64, affichee au-dessus des reponses |

### Workflow en 5 etapes

1. **Choisir** un des 2 prompts, la matiere et le theme.
2. **Remplacer** les champs entre `[...]`.
3. **Coller** le prompt dans une IA (ChatGPT, Claude, Gemini, Mistral...).
4. **Enregistrer** la reponse dans `data/<matiere>/<fichier>.json`.
5. **Declarer** le quiz dans `data/config.json` (bloc pret plus bas).

> Si l'IA ajoute du texte autour, ne gardez que ce qui est entre la premiere `{`
> et la derniere `}`. Vous pouvez aussi coller le resultat dans **QuizMaster**
> pour le verifier et le tester.

---

### Prompt 1 — QCM general (complet)

```text
Tu es professeur et generateur de questionnaires scolaires pour une application
web. Produis LE FICHIER JSON COMPLET d'un questionnaire, pret a etre enregistre.
Reponds UNIQUEMENT avec le JSON : aucun texte, aucune balise markdown.

=== COMMENT LE MOTEUR LIT CE FICHIER (a respecter a la lettre) ===
Le fichier decrit un questionnaire divise en categories. Chaque question est
soit un QCM ("mcq"), soit une reponse libre ("text"). Le moteur interprete :
- "type": "mcq"  -> boutons ; "options" = liste des choix ;
                    "correct" = INDEX de la bonne reponse (0 = 1er choix).
- "type": "text" -> champ de saisie ; "accepted" = TOUTES les reponses acceptees
                    (majuscules, espaces et virgules sont ignores).
- "solution"     -> explication affichee a l'eleve apres sa reponse.
- "image"        -> (facultatif) URL ou base64 affichee au-dessus des reponses.

=== STRUCTURE EXACTE (memes cles, memes niveaux) ===
{
  "subject": "[MATIERE]",
  "title": "[TITRE DU QUESTIONNAIRE]",
  "description": "[COURTE DESCRIPTION]",
  "css": "[CSS PERSONNALISE FACULTATIF, ex : .important{color:#f59e0b;font-weight:900;}]",
  "categories": [
    {
      "category": "1. [NOM DE LA CATEGORIE]",
      "questions": [
        {
          "text": "Question a choix multiple ?",
          "type": "mcq",
          "image": "[FACULTATIF : URL, chemin, ou data:image/png;base64,...]",
          "options": ["Choix A", "Choix B", "Choix C"],
          "correct": 0,
          "solution": "Explication claire de la bonne reponse."
        },
        {
          "text": "Question a reponse libre ? (tu peux aussi mettre <img src='...'> dans le texte)",
          "type": "text",
          "accepted": ["reponse attendue", "variante acceptee"],
          "solution": "Explication detaillee."
        }
      ]
    }
  ]
}

=== PARAMETRES DE CE QUESTIONNAIRE ===
- Matiere : [MATIERE]                 (ex : Italien)
- Niveau : [NIVEAU]                   (ex : Seconde)
- Theme : [SUJET DETAILLE]
- Nombre de categories : [N]          (ex : 5)
- Questions par categorie : entre [X] et [Y]
- Total minimum : [TOTAL]
- Langue des intitules et explications : [LANGUE]

=== REGLES STRICTES ===
1. Reponds UNIQUEMENT par le fichier JSON (pas de texte, pas de balises).
2. Utilise EXACTEMENT ces cles : subject, title, description, css (facultatif),
   categories, category, questions, text, type, image (facultatif), options,
   correct, accepted, solution.
3. "correct" est un NOMBRE (index) pour "mcq" : n'y mets jamais du texte.
4. "accepted" est une LISTE de chaines pour "text".
5. Dans les chaines : guillemets simples (') pour le HTML, guillemets francais
   « » pour citer. Jamais de guillemets doubles non echappes.
6. Aucun retour a la ligne reel dans une chaine : utilise <br> ou <p>.
7. Aucun LaTeX. Puissances : x<sup>2</sup>. Multiplication : ×.
8. Tu peux utiliser du HTML/des classes dans "text" et definir les styles dans
   "css" (ex : <span class='important'>mot</span>). Classes fournies :
   couleur-qui-change, clignotant, anim-border-fade.
9. IMAGES : tu peux ajouter une image a une question avec le champ "image"
   (URL, chemin, ou data-URI base64 : "data:image/png;base64,....") OU une balise
   <img src='...'> dans le "text". Si j'ai fourni le base64, recopie-le tel quel.
10. Varie les questions (vocabulaire, comprehension, application, production) et
    les distracteurs. Accorde correctement genre et nombre.
11. Verifie que le JSON est valide (virgules, accolades, crochets) avant de repondre.

THEME A TRAITER : [SUJET DETAILLE]
```

---

### Prompt 2 — QCM de mathematiques (complet)

```text
Tu es professeur de mathematiques et generateur de questionnaires pour une
application web. Produis LE FICHIER JSON COMPLET d'un QCM de mathematiques,
pret a enregistrer. Reponds UNIQUEMENT avec le JSON : aucun texte, aucune balise.

=== COMMENT LE MOTEUR LIT CE FICHIER ===
- "type": "mcq"  -> boutons ; "options" = choix ; "correct" = INDEX de la bonne
                    reponse (0 = premier choix, 1 = deuxieme...).
- "type": "text" -> champ de saisie ; "accepted" = liste des reponses acceptees
                    (espaces, virgules et majuscules ignores).
- "solution"     -> correction detaillee affichee apres la reponse.

=== STRUCTURE EXACTE ===
{
  "subject": "Mathematiques",
  "title": "[TITRE]",
  "description": "[COURTE DESCRIPTION]",
  "categories": [
    {
      "category": "1. [THEME]",
      "questions": [
        {
          "text": "Enonce (HTML autorise pour les maths)",
          "type": "mcq",
          "options": ["Reponse A", "Reponse B", "Reponse C"],
          "correct": 0,
          "solution": "Correction detaillee, etape par etape."
        },
        {
          "text": "Enonce a reponse libre",
          "type": "text",
          "accepted": ["resultat", "resultat avec unite"],
          "solution": "Correction detaillee."
        }
      ]
    }
  ]
}

=== FORMATAGE DES MATHS (TRES IMPORTANT) ===
- INTERDIT : LaTeX ($$, \frac, \times, \cdot, \sqrt en LaTeX).
- Fraction :
  <div class='math-frac'><span class='math-num'>NUMERATEUR</span><span class='math-den'>DENOMINATEUR</span></div>
- Puissance : x<sup>2</sup>
- Multiplication : ×   (jamais *)
- Racine : √(...) ou &radic;   - Degres : 90°
- Fractions numeriques simples en ligne si plus clair : 3/4.

=== REGLES STRICTES ===
1. Reponds UNIQUEMENT par le JSON (aucun texte, aucune balise).
2. "correct" = INDEX de la bonne reponse (nombre), pas le texte.
3. "solution" = correction redigee etape par etape (calculs intermediaires).
4. Un seul bon choix par QCM ; les distracteurs doivent etre plausibles
   (erreurs de calcul typiques, confusion d'unites, etc.).
5. Aucun retour a la ligne reel dans une chaine : utilise <br>.
6. Guillemets simples (') pour le HTML interne.
7. Verifie que le JSON est valide avant de repondre.

=== PARAMETRES ===
- Niveau : [NIVEAU]
- Theme(s) / chapitre(s) : [SUJET]
- Nombre de categories : [N]
- Questions par categorie : entre [X] et [Y]
- Total minimum : [TOTAL]

THEME A TRAITER : [SUJET]
```

---

### Declarer le fichier dans `data/config.json`

Une fois le fichier cree, ajoutez un objet dans le tableau `"quizzes"` :

```json
{
  "id": "italien-presentare-persona",
  "title": "Presentare una persona — aspetto e abbigliamento",
  "subject": "italien",
  "file": "data/italien/presentare-una-persona.json",
  "questionsCount": 84,
  "description": "Descrivere una persona in italiano : aspetto, abbigliamento, strutture.",
  "tags": ["italien", "descrizione", "vocabolario"],
  "added": "2026-09-12"
}
```

- `id` : identifiant unique, en minuscules avec des tirets.
- `subject` : doit correspondre a un `id` du tableau `"subjects"`.
- `file` : chemin relatif depuis la racine du site.
- `added` (facultatif) : date d'ajout `AAAA-MM-JJ`, utilisee pour la section
  automatique **Nouveautes**.

### Images (URL, fichier local ou base64)

Deux methodes sont possibles.

**1. Champ `image` d'une question** (affiche sous l'enonce) :

```json
{
  "text": "Que montre ce schema ?",
  "type": "mcq",
  "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
  "options": ["Un triangle", "Un cercle"],
  "correct": 0,
  "solution": "C'est un triangle."
}
```

**2. Image directement dans le `text`** (position libre, via HTML) :

```html
<div style='text-align:center; margin:1rem 0;'>
  <img src='matiere/theme/illustration.svg' alt='Description' style='max-width:400px;'>
</div>
<p style='text-align:center; font-size:0.75rem; color:#94a3b8;'>Legende ou source</p>
```

- `image`/`src` accepte : une **URL** (`https://...`), un **fichier local**
  (`matiere/theme/image.svg`) ou une **data-URI base64**
  (`data:image/png;base64,...`).
- Le **base64** rend le quiz autonome (aucun fichier externe), mais attention au
  **poids** : une image base64 augmente fortement la taille du JSON. Prefere une
  version compressee (WebP/PNG optimisee) et reste sous ~100-200 Ko par image.
- Genere le base64 avec : `base64 -w0 image.png` (Linux/macOS) et prefixe le
  resultat par `data:image/png;base64,`.

### Verifier le JSON avant de publier

```bash
# Valide le fichier (affiche une erreur de ligne si le JSON est casse)
python3 -m json.tool data/<matiere>/<fichier>.json > /dev/null && echo "JSON valide"
```

Vous pouvez aussi le coller dans **QuizMaster** (`quizmaster.html`) : s'il charge
et affiche les questions, il est bon.

### Erreurs frequentes

| Probleme | Cause | Correction |
|---|---|---|
| Rien ne s'affiche | JSON invalide | Verifier la virgule finale / les guillemets (`python3 -m json.tool`) |
| « Fichier indisponible » | Mauvais chemin dans `file` | Le chemin part de la racine (`data/...`) |
| Quiz absent du portail | Manque dans `quizzes` | Ajouter le bloc dans `data/config.json` |
| Accents casses | Fichier mal encode | Enregistrer en **UTF-8** |
| Bonne reponse toujours fausse | `correct` mal place | Pour `mcq`, `correct` est un **index** ; pour le format simple, c'est le **texte exact** |
| Reponse libre jamais acceptee | `accepted` incomplet | Ajouter les variantes (accents, ordre des mots) |
| Fractions cassees | LaTeX utilise | Utiliser `<div class='math-frac'>...` |

---

## PWA / Offline

Le site fonctionne comme une PWA. Une fois charge, il est accessible hors-ligne. Installez-le sur votre telephone ou ordinateur via le menu du navigateur.

---

## Lancer le site en local (tests)

Le portail utilise `fetch()` et un service worker : il doit etre servi en
**HTTP** (pas ouvert directement en `file://`). Le script `run.sh` s'occupe de
tout et ajoute des en-tetes **no-cache** pour voir immediatement vos
modifications.

```bash
# Port 8000 par defaut, ouvre le navigateur
./run.sh

# Port personnalise
./run.sh 9000

# Sans ouvrir le navigateur
./run.sh 9000 --no-open
```

- **Local** : `http://localhost:8000/`
- **Reseau** : le script affiche aussi une adresse `http://192.168.x.x:8000/`
  a ouvrir depuis un telephone sur le **meme Wi-Fi** (pratique pour tester la PWA).
- **Arret** : `Ctrl+C`.
- Prerequis : **Python 3** (rien a installer d'autre).

> Si le navigateur a encore une ancienne version a cause du service worker,
> faites un rechargement force : **Ctrl+Shift+R** (ou videz le cache).

---

## Deploiement

Le deploiement se fait automatiquement via GitHub Pages a chaque push sur `main`. Voir `.github/workflows/static.yml`.

### Mise a jour du service worker

Apres avoir ajoute/retire des fichiers, lancez le script pour mettre a jour la liste des assets caches :

```bash
bash scripts/generate-sw.sh
```

---

Projet maintenu par **rraattrruuee**.
