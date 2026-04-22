# Eval System V2 — Architecture Diagrams (PlantUML)

Each `.puml` file contains exactly **one** `@startuml ... @enduml` block so any
PlantUML renderer (VS Code preview, IntelliJ, plantuml.com, CLI) can open it
unambiguously.

| File | Diagram | Type |
| --- | --- | --- |
| `01_system_context.puml`   | System context (3-tier + hardware layer)   | Component |
| `02_component_view.puml`   | Frontend / Backend / Data / Hardware components | Component |
| `03_deployment_view.puml`  | Docker, Postgres, dnsmasq, eth0/eth1, Zybo farm | Deployment |
| `04_data_model.puml`       | Tables: files, boards, board_status, jobs, results, test_cases | Class (ER) |
| `05_runtime_flow.puml`     | End-to-end job execution sequence | Sequence |
| `06_three_tier_block.puml` | Picture 3-1 - simple 3-tier block diagram (Browser / FastAPI / DB+Files) | Component |
| `07_common_workflow_sequence.puml` | Picture 3-2 - numbered sequence: upload -> create job -> trigger -> status | Sequence |

## Render

VS Code (PlantUML extension):

- Open any `.puml` file → `Alt+D` to preview.

CLI (requires `plantuml` + Java):

```bash
plantuml -tsvg docs/architecture/*.puml
```

Online: paste the file contents into <https://www.plantuml.com/plantuml>.

## Notes

- The previous combined file `docs/SYSTEM_ARCHITECTURE.puml` was split because
  some PlantUML preview tools concatenate multiple `@startuml` blocks and lock
  the diagram type to whichever block appears first (component), which then
  rejects the `class` keyword used in the data model diagram.
