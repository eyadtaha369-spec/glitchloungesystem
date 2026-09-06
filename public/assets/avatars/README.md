# Owner Table avatars

Drop a photo here named after the owner table it belongs to (lowercase,
matching the table's exact name in the app), and it will automatically
appear as that table's avatar on the Lounge page — no code changes needed.

Currently mapped in `src/components/glitch/Rooms.tsx` (`OWNER_TABLE_AVATARS`):

- `abdelrazek.jpg` — for the owner table named "Abdelrazek"
- `3omda.jpg` — for the owner table named "3omda"

To add a new owner table's avatar:
1. Rename or create the owner table with the person's name (Setup page).
2. Drop a `.jpg` or `.png` photo here named to match (lowercase).
3. Add a line to `OWNER_TABLE_AVATARS` in Rooms.tsx mapping the lowercase
   name to `/assets/avatars/<name>.jpg`.

Until a photo is added, that table shows a styled initials avatar instead.
