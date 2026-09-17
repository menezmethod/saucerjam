# Active scale baseline 02

Command: `node scripts/verification/scale-server.cjs` on 2026-09-17. Each local Socket.IO client sends deterministic movement and laser input every 50 ms for 1.5 seconds. The verifier aggregates every recipient's raw JSON state and event payloads; it is not wire-compressed network telemetry.

| Pilots | Server tick Hz | State bytes/s | Event bytes/s | Mean state bytes | Visible pilots |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 59.3 | 505,690 | 23,805 | 3,164 | 4.2 |
| 32 | 60.0 | 6,098,418 | 434,395 | 9,534 | 16.4 |
| 64 | 59.3 | 22,012,579 | 1,784,856 | 17,220 | 31.8 |
| 128 | 59.8 | 89,349,653 | 8,438,568 | 35,009 | 71.5 |

The server maintained approximately 60 Hz locally. The verified first public admission step is **32 pilots**: about 6.5 MB/s aggregate raw payload before Socket.IO framing, packet loss, real network latency, client rendering, or a production deployment. A real-host and real-device run remains required before promotion to 64.

At 64 and especially 128, moving pilots and their projectiles change in recipient snapshots at 20 Hz while fire/impact events fan out to nearby observers. Do not promote 64 from this local result alone. The 128 result remains a hostile dense-hotspot ceiling, not player-capacity proof.
