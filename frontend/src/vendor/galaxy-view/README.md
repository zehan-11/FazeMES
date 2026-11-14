# Galaxy View rendering subset

Source: https://github.com/Longwind1984/galaxy-view
Pinned commit: b49b60cb04687783153f24ff7f9b0a0af59334af (0.6.1)
Copyright (c) 2026 Rick. MIT; full license in LICENSE.

Copied rendering: AggregateRenderer, starfield, nebula, shaders, curved links,
reveal, palette, coordinate fitting, rendering tokens, quality tiers and their
pure graph helpers. Obsidian entry points, vault index, UI, GraphController,
force workers and camera director are intentionally not imported.
settings.ts and settings/graphJsonImport.ts are standalone type contracts.
FazeMES uses its existing Three.js 0.160 dependency; no Obsidian runtime needed.
The Vue wrapper supplies orbit controls, lifecycle, entity metadata and selection.
Prototype positions are deterministic, not a migration of upstream force physics.

The application entry is views/mes/graph/KnowledgeGraph.vue, lazy mounted in the
AI assistant's knowledge graph tab. The adapter accepts stable string entity and
relation IDs for a later backend/Neo4j response; no database credentials or calls
are present. All example data and source excerpts are synthetic and labelled.
