// One uniform path for both road looks, no shader compile when switching.
// The atlas remains intact; Roads off restores its exact original contribution.
export const roadRasterWeight = {value: 1};
export function roadLook(value) { return Number(value) === 3 ? 3 : 2; }
