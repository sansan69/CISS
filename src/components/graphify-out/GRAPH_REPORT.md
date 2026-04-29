# Graph Report - src/components  (2026-04-29)

## Corpus Check
- 55 files · ~25,281 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 104 nodes · 53 edges · 3 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]

## God Nodes (most connected - your core abstractions)
1. `ErrorBoundary` - 5 edges
2. `applyCoordinates()` - 4 edges
3. `fetchTodos()` - 2 edges
4. `handleCreate()` - 2 edges
5. `handleGeocode()` - 2 edges
6. `updateManualCoordinates()` - 2 edges
7. `handleMapSelect()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 1 - "Community 1"
Cohesion: 0.53
Nodes (4): applyCoordinates(), handleGeocode(), handleMapSelect(), updateManualCoordinates()

### Community 2 - "Community 2"
Cohesion: 0.5
Nodes (2): fetchTodos(), handleCreate()

## Knowledge Gaps
- **Thin community `Community 0`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 2`** (5 nodes): `fetchTodos()`, `handleCreate()`, `handleDelete()`, `handleStatusChange()`, `todo-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Not enough signal to generate questions. This usually means the corpus has no AMBIGUOUS edges, no bridge nodes, no INFERRED relationships, and all communities are tightly cohesive. Add more files or run with --mode deep to extract richer edges._