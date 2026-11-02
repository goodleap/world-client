# Home management and command feedback — batch 1

Implements the user's approved items 1–5 as one batch: compact centered selection card, resource/group tabs, up to four saved groups of six living friendly units, frequent alternating raids, an initial home center with recruitment, and a short real route after a successful work order releases selection.

The home center uses the existing building reference (`world-design/场景素材原型图/建筑与设施.png`), rounded plaster/timber/stone and curved terracotta tiles, a folded blue banner, clear front entrance and rally area. It is a 3×3 permanent starting building; it does not increase stored inventory capacity.

Recruitment reserves usable stored resources and population immediately; cancellation refunds, including ground overflow if storage filled meanwhile. One queue of five completes in order. A completed recruit waits if no safe body-sized exit exists. Human limit 20, dog limit 4. New cavalry keep independent rider and horse vitals. Shared Babylon containers keep per-unit skeletons and animation playback; dog clones share geometry/materials and use native LOD. Finished raid actors release their skeletons, animations, meshes and labels before the next wave.

Save schema 13 deliberately rejects previous schemas. Roster, queue, population reservations, rally, groups, raid warning and wave participants are validated and persisted. Selection and the 2.5-second confirmation strip are transient UI state. Normal selected routes stay fixed to the ground; the short confirmation uses the same mesh and fades in its final 0.5 game second.

Raid trial: first at 60 active seconds; warning 8 seconds; next 45–75 seconds after completion; alternate wolves/soldiers, 2 initially, up to 6. Fewer than two healthy defenders reduces the wave to one instead of suppressing raids indefinitely. Prefer distant offscreen entrances; if the overview sees all entrances, a distant announced valid entrance is allowed. Existing camp and wild wolf state is independent.

Group membership does not interrupt orders. Move assigns loose slots scaled to the largest body, then uses each unit's normal collision-aware path; partial acceptance is reported. Attack dispatch filters combat units. No rigid formation or automatic multi-worker distribution is added. The card shows summed bars and a representative actual path.

Validation: TypeScript check and Vite production build passed; 206 logic tests passed. Three production Chromium checks passed: desktop recruitment/group movement/save, mobile recruitment/320/412/844×390 layouts/save, and temporary work route/pause/expiry. The browser checks verify independently animated dogs share geometry/materials, mounted recruits load, queued costs refund, and population/groups survive reload. All page-error collections were empty.

Actually inspected native 3D screenshots: [center and recruits](home-center-recruits.png), [group movement](group-move-desktop.png), [group editor](groups-desktop.png), [phone recruitment](recruit-mobile.png), [320px card](compact-320.png), [short screen](compact-short.png), [released work route](accepted-work-route.png). The first browser check caught a dog LOD binding to the picking sphere; it was corrected to the skinned LOD-0 mesh and rechecked with both dogs animated.

Limits: no rigid formation, individual group-member editing on the world card, recruitment upgrades or new building damage rules in this batch. Cloud software WebGL is for functional/visual checks, not a physical phone battery or FPS measurement. The production bundler still reports its existing large-chunk warning.
