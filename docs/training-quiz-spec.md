# Training Modules + Question Banks + Quiz — Spec

Source of truth for training/quiz feature. Update here before code changes.

## User flows

### Admin
1. Open **Training Modules** page.
2. Upload content file (`.pdf`, `.pptx`, image — jpg/png/webp).
3. Save module details (title, description, category, duration, passing score).
4. File stored in Firebase Storage; record saved in Firestore `trainingModules`.
5. Open **Question Banks**; create or import a bank linked to a module.
6. Add many questions (MCQ: prompt, options[], correctIndex, explanation?).
7. Choose random-quiz settings (pool size, questions-per-attempt, time limit, shuffle).
8. Optionally assign module to specific guards (bypassing district/FO flow).

### Field Officer
1. Open **Field Officers** workspace → **Training** tab (new).
2. Browse active modules.
3. Preview / download module file.
4. Assign existing module to guards within `assignedDistricts`.
5. See completion dashboard: completed / failed / pending per module.
6. See latest quiz scores for guards under their districts.

### Guard
1. Open **Guard → Training** page.
2. See only assigned modules.
3. Open content:
   - `.pdf` / image → native browser render.
   - `.pptx` → native download + Office 365 embed viewer fallback (public signed URL → `https://view.officeapps.live.com/op/embed.aspx?src=<url>`).
4. Start quiz → random question set pulled from linked bank.
5. Submit answers → score, pass/fail, result summary shown.

### Evaluation connection
- Quiz attempts feed `quizAttempts` → aggregated into guard's `trainingPerformance` summary.
- Admin + FO can cite quiz score inside guard evaluation records (no duplicate entry).

## Data model (Firestore)

### `trainingModules/{moduleId}`
- `title`, `description`, `category`, `durationMinutes`, `passingScore`
- `contentUrl` (Firebase Storage download URL)
- `contentType`: `pdf | pptx | image`
- `contentPath` (Storage path, for deletion)
- `isActive`, `createdAt`, `createdBy`
- `quizSettings`: `{ questionsPerAttempt, timeLimitMinutes, shuffle, maxAttempts }`

### `questionBanks/{bankId}`
- `moduleId`, `title`, `createdAt`, `createdBy`, `questionCount`

### `questionBanks/{bankId}/questions/{questionId}`
- `prompt`, `options[]` (string[]), `correctIndex` (number), `explanation?`, `weight?`

### `moduleAssignments/{assignmentId}`
- `moduleId`, `guardDocId`, `assignedBy` (admin or FO uid), `assignedByRole`, `assignedDistrict?`, `status`: `pending | in_progress | passed | failed`, `assignedAt`, `dueAt?`

### `quizAttempts/{attemptId}`
- `moduleId`, `bankId`, `guardDocId`, `answers` (compact), `score`, `passed`, `startedAt`, `submittedAt`, `durationSeconds`

### Derived on guard doc
- `trainingPerformance`: `{ completedModules, avgScore, lastAttemptAt }` (updated on submit).

## Storage layout

```
trainingModules/{moduleId}/content.{pdf|pptx|jpg|png|webp}
```

- `storage.rules`: signed-in read; admin-only write. Guard reads only assigned modules (enforced via rules + assignment check, or via short-lived signed URLs from server).

## Accepted upload formats

- `.pdf` (`application/pdf`)
- `.pptx` (`application/vnd.openxmlformats-officedocument.presentationml.presentation`)
- images: `.jpg`, `.jpeg`, `.png`, `.webp`
- max size: 25 MB (tunable)

## Rendering strategy

- **pdf / image**: browser native (`<iframe>` for pdf, `<img>` for image).
- **pptx**: download link + Office 365 embed iframe when URL is publicly signed.
- No server-side conversion in phase 1. Revisit if pptx embed fails for users.

## Phased plan

**Phase 1 — Admin CRUD**
- Extend `api/admin/training/modules` to handle storage upload metadata + `contentType`.
- Add admin UI: upload + module detail form.

**Phase 2 — Question Banks**
- APIs: `api/admin/training/banks`, `.../banks/[id]/questions`.
- Admin UI: bank create/import (CSV or JSON), question editor.

**Phase 3 — Assignment**
- API: `api/admin/training/assignments`, `api/field-officers/training/assignments` (district-scoped).
- Admin + FO UI.

**Phase 4 — Guard quiz**
- Guard training page + quiz runner.
- Attempt submit API → score calc + `trainingPerformance` update.

**Phase 5 — Reporting**
- FO dashboard: completion + scores.
- Evaluation integration: read-only link into guard evaluation form.

## Open questions

- Passing score override per-module vs global default?
- Retake policy / cooldown?
- Question import format — CSV columns?
