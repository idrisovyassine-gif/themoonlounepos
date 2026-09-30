# Migration 002 — totaux et cuisine

Cette migration ajoute `service_charge_cents` et `tip_cents` aux commandes, puis indexe les groupes
d’options et leurs choix. Les prix affichés restent TTC : `tax_cents` mémorise la part de TVA incluse,
tandis que les frais de service et pourboires sont ajoutés explicitement au total final.
