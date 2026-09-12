export type AppRole = "SUPERADMIN"|"OPERATIONS_MANAGER"|"FINANCE"|"DISPATCHER"|"AUDITOR"|"RIDER";
const routeRoles: Record<string, AppRole[]> = {
  "/": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER","AUDITOR"],
  "/operations/batches": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER"],
  "/operations/dispatch": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER","AUDITOR"],
  "/finance": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","AUDITOR"],
  "/reports": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","AUDITOR"],
  "/settings": ["SUPERADMIN","OPERATIONS_MANAGER"],
  "/profile": ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER","AUDITOR"],
};
export function canAccessRoute(role:string|undefined,path:string) {
  if (!role) return false;
  const base=path.startsWith("/batches/")?"/operations/batches":Object.keys(routeRoles).find(key=>key!=="/"&&path.startsWith(key))??"/";
  return routeRoles[base]?.includes(role as AppRole)??false;
}
export function roleHome(role:string|undefined) {
  if(role==="RIDER")return "/rider-app";
  if(role==="FINANCE"||role==="AUDITOR")return "/finance";
  return "/";
}
