// assembly-mask.js (s21:V1): hides a list of objects only inside one render call and restores them in a finally,
// exactly as underground-cull.js does, so compileAsync, warm-ups and hover still see them. Never layer masks (D-040).
export function createAssemblyMask() {
  const hidden = [];
  return {
    render(list, draw) {
      hidden.length = 0;
      if (list) for (const o of list) if (o && o.visible) { o.visible = false; hidden.push(o); }
      try { return draw(); } finally { for (const o of hidden) o.visible = true; hidden.length = 0; }
    },
  };
}
