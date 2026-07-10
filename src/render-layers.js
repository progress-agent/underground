// Central render-order + surface-lift registry.
//
// Three.js draws the OPAQUE queue front-to-back (depth-tested, order mostly
// moot) then the TRANSPARENT queue back-to-front BY CAMERA DISTANCE unless
// two objects share differing `renderOrder` — in that case renderOrder wins
// outright, low-to-high, regardless of distance. Every module in this scene
// draws overlapping transparent volumes (river, canals, reservoirs, tube
// tunnels, Tideway, Crossrail, sewers, the chalk plane) — before this
// registry most of them left `renderOrder` unset (defaults to 0), so THREE
// fell back to the per-frame distance sort for anything tied at 0. Two
// coplanar meshes (e.g. a reservoir polygon and its own EdgesGeometry
// outline, sitting at near-identical camera distance) flip order from frame
// to frame as the camera moves a few units — that flicker is what this file
// exists to kill by making the draw order explicit and deliberate.
//
// Tiers are ascending: lower draws first (further back in the deliberate
// stack), higher draws last (further forward). Where two tiers share a
// numeric value (e.g. INFRA_TUNNEL / SEWER both = 2) that's intentional —
// those categories don't spatially overlap each other, only the distance
// sort within a shared tier is left to THREE, which is fine when the
// members of that tier don't share a near-coplanar surface.
export const RENDER_ORDER = {
  TERRAIN: -1,        // terrain.js top + underside meshes — always drawn first
  SURFACE_ROAD: 0,    // m25.js road ribbon (opaque; value kept for documentation)
  GEOLOGY: 1,         // geology.js chalk boundary plane + wireframe + marker.
                       // Deliberate choice: infra tunnels (tier 2) draw AFTER
                       // geology so deep infra (e.g. Lee Tunnel at 98m, below
                       // the 60m chalk plane) never flips order with the sheet
                       // on a distance-sort tie. NOTE (10Jul26f): tier order
                       // does NOT prevent depth-culling — the chalk sheet has
                       // depthWrite:true, so once drawn, any infra BEHIND it
                       // (from the camera) fails the depth test regardless of
                       // renderOrder. From above the chalk this hides all
                       // below-chalk infra (accepted); from INSIDE the chalk,
                       // updateGeologyClarity releases sheet opacity+depthWrite
                       // so the up-view network is visible (Item B).
  SURFACE_WATER: 1,   // thames.js river volume, canals.js ribbons,
                       // reservoirs.js water polygon, m25.js Thames waterfalls
  WATER_EDGE: 2,      // reservoirs.js EdgesGeometry outline — must draw AFTER
                       // (and sit slightly above, see RESERVOIR_EDGE_LIFT) its
                       // own reservoir mesh, otherwise the outline and the
                       // water polygon are coplanar-in-distance and flicker
                       // order every frame. This IS the reservoir flicker fix.
  INFRA_TUNNEL: 2,    // tube tunnels (main.js frostedTubeMaterial), tideway.js
                       // tunnels/glow/spurs, crossrail.js tunnels/glow/markers.
                       // Convention (10Jul26f): glow SHELLS are depthWrite:false
                       // (createGlowMaterial) — a depth-writing shell would
                       // depth-cull the tunnel it encloses. Tunnel walls are
                       // FrontSide + depthWrite:true (createTunnelMaterial) so
                       // exactly one wall layer composites at every angle.
  SEWER: 2,           // sewers.js tunnels/glow/markers — same tier as
                       // INFRA_TUNNEL (named separately for call-site clarity;
                       // sewers don't spatially overlap the deep-bore infra)
  SHAFT: 3,           // shafts.js station shafts, tideway.js Tideway/Lee shaft
                       // cylinders. Was literal 2 in shafts.js pre-registry;
                       // bumped to 3 here so shafts still draw strictly after
                       // the now-explicit INFRA_TUNNEL/SEWER tier (2) —
                       // preserving the prior effective order, where shafts
                       // (renderOrder 2) rendered after everything else that
                       // was left at the implicit default of 0.
  STATION: 5,         // stations.js InstancedMesh markers — drawn last

  // ── Exterior tapered column (D1) — geology-exterior.js ─────────────────
  EXTERIOR_SKIRT: 0,  // Clay disc skirt: an OPAQUE vertical wall on the M25
                       // boundary (local surface → chalk top). Opaque, so the
                       // renderOrder is documentary — depth sorts it. Kept at 0
                       // alongside SURFACE_ROAD (it never overlaps the road).
  EXTERIOR_COLUMN: 1, // Fading chalk column below the disc: TRANSPARENT (vertex
                       // alpha ramp opaque→0 with depth). Tier 1 shares GEOLOGY/
                       // SURFACE_WATER — it meets the chalk floor at the rim and
                       // sits behind the Thames waterfalls (which spill in front,
                       // resolved by the back-to-front distance sort within the
                       // tier: the near falling ribbon draws after the far column
                       // wall). It never spatially overlaps infra (tier 2+).
};

// Anti-z-fight Y lifts (scene units) — previously four separate uncoordinated
// literals (thames.js SURFACE_LIFT=2, canals.js SURFACE_LIFT=2,
// reservoirs.js SURFACE_LIFT=5, geology.js wireframe +0.5). Unified here so
// new callers import instead of re-inventing a slightly different number.
export const WATER_LIFT = 2;             // Thames volume + canal ribbons above carved terrain
export const RESERVOIR_LIFT = 5;         // Reservoir polygon above highest terrain point in the basin
export const RESERVOIR_EDGE_LIFT = 0.5;  // Reservoir EdgesGeometry outline, additional lift above the reservoir mesh
// (GEOLOGY_WIRE_LIFT retired — the 0.06-opacity chalk wireframe overlay was
//  deleted in the Wave-2 chalk-floor rewrite; it contributed nothing.)
