#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quiz_lib.py — Helpers pour générer des questionnaires VALIDES.

Objectif anti-régression : le champ `correct` d'une question QCM doit être un
ENTIER (index 0-based dans `options`). Ce module accepte en plus, par confort,
la CHAÎNE de la bonne réponse et la convertit automatiquement en index.
Ainsi il devient impossible de produire un JSON invalide par inadvertance.

Utilisation recommandée dans un script générateur :

    import sys
    sys.path.insert(0, "scripts")
    from quiz_lib import Q, VF, TXT, write_quiz

    questions = [
        Q("Capitale de l'Italie ?", ["Rome", "Paris", "Madrid", "Berlin"], "Rome", "Rome est la capitale."),
        VF("476 = chute de l'Empire romain d'Occident.", True, "Oui."),
        TXT("Quel fleuve traverse Paris ?", ["Seine", "la Seine"], "La Seine."),
    ]

    quiz = {
        "subject": "histoire-geo",
        "title": "Mon quiz",
        "description": "Description.",
        "categories": [{"category": "Catégorie", "questions": questions}],
    }
    write_quiz(quiz, "data/histoire-geo/mon-quiz.json")
"""

import json
import os


def _resolve_correct(options, correct):
    """Retourne l'index 0-based de la bonne réponse.

    Accepte :
      - un entier (index, validé dans les bornes) ;
      - une chaîne égale à l'une des options (convertie en index).
    Refuse tout le reste avec un message explicite.
    """
    if isinstance(correct, bool):  # bool est une sous-classe de int : à refuser
        raise TypeError("`correct` ne doit pas être un booléen.")
    if isinstance(correct, int):
        idx = correct
    elif isinstance(correct, str):
        matches = [i for i, opt in enumerate(options) if opt == correct]
        if not matches:
            raise ValueError(
                "`correct` = %r ne correspond à AUCUNE option parmi %r"
                % (correct, options)
            )
        if len(matches) > 1:
            raise ValueError(
                "`correct` = %r correspond à plusieurs options (index %r) : options en doublon ?"
                % (correct, matches)
            )
        idx = matches[0]
    else:
        raise TypeError(
            "`correct` doit être un entier (index) ou la chaîne d'une option ; reçu %r"
            % (correct,)
        )

    if not (0 <= idx < len(options)):
        raise ValueError(
            "`correct` = %r hors bornes : options=%d" % (idx, len(options))
        )
    return idx


def Q(text, options, correct, solution, **extra):
    """Construit une question QCM valide (correct = index ou texte d'option)."""
    options = list(options)
    if len(options) < 2:
        raise ValueError("Une QCM doit avoir au moins 2 options : %r" % (text,))
    if len(set(options)) != len(options):
        raise ValueError("Options en doublon pour la question : %r" % (text,))
    if not isinstance(solution, str) or not solution.strip():
        raise ValueError("`solution` obligatoire pour la question : %r" % (text,))
    q = {
        "text": text,
        "type": "mcq",
        "options": options,
        "correct": _resolve_correct(options, correct),
        "solution": solution,
    }
    q.update(extra)
    return q


def VF(text, is_true, solution):
    """Question Vrai/Faux (correct = 0 => premier choix)."""
    options = ["Vrai", "Faux"] if is_true else ["Faux", "Vrai"]
    return Q(text, options, 0, solution)


def TXT(text, accepted, solution):
    """Question à réponse libre (type text)."""
    if not isinstance(accepted, list) or not accepted:
        raise ValueError("`accepted` doit être une liste non vide : %r" % (text,))
    return {
        "text": text,
        "type": "text",
        "options": [],
        "correct": 0,
        "accepted": accepted,
        "solution": solution,
    }


def finalize(quiz):
    """Vérifie un questionnaire complet AVANT écriture et renvoie le total."""
    if not isinstance(quiz, dict):
        raise TypeError("quiz doit être un dict")
    for field in ("subject", "title", "description"):
        if not isinstance(quiz.get(field), str) or not quiz[field].strip():
            raise ValueError("champ %r manquant ou vide" % field)
    cats = quiz.get("categories")
    if not isinstance(cats, list) or not cats:
        raise ValueError("`categories` doit être une liste non vide")

    total = 0
    seen_cats = set()
    seen_texts = set()
    for ci, cat in enumerate(cats):
        name = cat.get("category")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("categories[%d].category manquant" % ci)
        if name in seen_cats:
            raise ValueError("catégorie en doublon : %r" % name)
        seen_cats.add(name)

        qs = cat.get("questions")
        if not isinstance(qs, list) or not qs:
            raise ValueError("categories[%d].questions vide" % ci)
        for qi, q in enumerate(qs):
            at = "categories[%d].questions[%d]" % (ci, qi)
            total += 1
            if not isinstance(q.get("text"), str) or not q["text"].strip():
                raise ValueError("%s.text manquant" % at)
            if not isinstance(q.get("solution"), str) or not q["solution"].strip():
                raise ValueError("%s.solution obligatoire" % at)
            key = " ".join(q["text"].split())
            if key in seen_texts:
                raise ValueError("%s: texte en doublon : %r" % (at, key[:60]))
            seen_texts.add(key)

            typ = q.get("type", "mcq")
            if typ == "mcq":
                opts = q.get("options")
                if not isinstance(opts, list) or len(opts) < 2:
                    raise ValueError("%s.options < 2" % at)
                if len(set(opts)) != len(opts):
                    raise ValueError("%s.options en doublon" % at)
                corr = q.get("correct")
                if not isinstance(corr, int) or isinstance(corr, bool):
                    raise ValueError(
                        "%s.correct doit être un ENTIER (reçu %r)" % (at, corr)
                    )
                if not (0 <= corr < len(opts)):
                    raise ValueError("%s.correct hors bornes" % at)
            elif typ == "text":
                acc = q.get("accepted")
                if not isinstance(acc, list) or not acc:
                    raise ValueError("%s.accepted non vide obligatoire" % at)
            else:
                raise ValueError("%s.type inconnu : %r" % (at, typ))
    return total


def write_quiz(quiz, out_path):
    """Valide puis écrit le questionnaire en UTF-8 (indent=2)."""
    total = finalize(quiz)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(quiz, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("✅ %s : %d questions, %d catégories" % (out_path, total, len(quiz["categories"])))
    return total


if __name__ == "__main__":
    print(__doc__)
