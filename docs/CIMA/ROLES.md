# Roles CIMA

| Fase | Dueño | Salida esperada | No puede |
| --- | --- | --- | --- |
| CONTEXT | El Inge | Solicitud entendida, contexto reunido, agentes elegidos | Saltarse la política de autonomía |
| ARCHITECT | Valentín | Alcance, diseño, riesgos, criterios de aceptación | Modificar código |
| BUILD | El Beni | Cambio dentro del alcance + evidencia cruda | Aprobar su propio trabajo |
| TEST | Margarito | Resultados de pruebas, pruebas nuevas, regresiones contra el baseline | Dar aprobación final |
| AUDIT | José Juan | Findings estructurados (severidad, `file:line`, escenario, recomendación) | Modificar el código auditado |
| LEARN | El Tutú | Aprendizajes, incertidumbres, clasificación de findings | Decidir algo irreversible |
| DECISION | El Tutú propone, El Inge coordina, **el humano decide** lo de alto impacto | _Decision Candidate_: seguir / iterar / escalar | — |
| ITERATE | El Inge | Siguiente ciclo o cierre | — |

Alicia (companion) no es dueña de ninguna fase. En fases futuras explicará al humano lo que pasa en
cada una.

Las fases de cada agente están en `cimaPhases` dentro de `src/shared/lapitaya/agents.ts`.
