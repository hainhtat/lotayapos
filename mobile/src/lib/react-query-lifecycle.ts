import {AppState,Platform,type AppStateStatus} from "react-native";
import {focusManager,onlineManager} from "@tanstack/react-query";

export function installReactQueryLifecycle(){
 const appState=AppState.addEventListener("change",(state:AppStateStatus)=>focusManager.setFocused(state==="active"));
 let removeOnline=()=>{};
 if(Platform.OS==="web"&&typeof window!=="undefined"){
  const update=()=>onlineManager.setOnline(typeof navigator==="undefined"?true:navigator.onLine);
  window.addEventListener("online",update);window.addEventListener("offline",update);update();
  removeOnline=()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update)};
 }
 return()=>{appState.remove();removeOnline();focusManager.setFocused(undefined);onlineManager.setOnline(true)};
}
