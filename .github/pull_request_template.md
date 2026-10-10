## Ce qui change

<!-- En deux ou trois phrases, pour un collègue qui découvre la modification. -->

## Vérifications

- [ ] `npm run check` passe (vérification du code et tests)
- [ ] Toute requête sur des données d'un commerce est filtrée par `store_id`
- [ ] Les nouvelles routes vérifient la bonne permission (`ctx.need(...)`)
- [ ] Les textes visibles sont en français, sans jargon
- [ ] Changement de la base : nouvelle migration dans `src/core/db.js` (jamais de modification d'une migration existante)
- [ ] Documentation mise à jour si besoin (`docs/`)
