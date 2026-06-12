/** Starter Server Memory docs, applied via `/memory template`. */
export const memoryTemplates: Record<string, string> = {
  general: `# Server conventions
- Package manager: (pnpm/npm/yarn — pick one, never mix)
- Code style: follow the existing patterns in the file you're editing
- Tests: add or update tests for behavior changes
- Commits/PRs: small and focused; explain the why in the PR body
- Never introduce new dependencies without a strong reason`,

  "godot-gdscript": `# Godot project conventions
- GDScript: typed where practical (var x: int), snake_case members, PascalCase classes
- Scene files (.tscn) are data: describe scene changes in human terms in summaries
- Signals over polling; connect in _ready()
- Node paths: use unique names (%Node) over brittle absolute paths
- Keep _process/_physics_process light; prefer signals/timers`,

  "unity-csharp": `# Unity project conventions
- C#: PascalCase public members, camelCase private with _ prefix optional — match existing
- Prefabs/ScenesAssets are data: describe changes in human terms (component, property, before → after)
- [SerializeField] private over public fields
- No Find()/GetComponent() in Update loops — cache references
- Keep MonoBehaviours thin; logic in plain C# classes where possible`,
};
