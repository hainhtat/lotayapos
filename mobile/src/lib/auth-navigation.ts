export type AuthNavigationState="loading"|"anonymous"|"authenticated";

export function getAuthNavigationState(loading:boolean,hasUser:boolean):AuthNavigationState{
  if(loading)return "loading";
  return hasUser?"authenticated":"anonymous";
}
