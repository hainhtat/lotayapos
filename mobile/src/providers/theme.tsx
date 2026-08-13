import {createContext,useContext,useEffect,useState} from "react";
import {useColorScheme} from "react-native";
import {kvGet,kvSet} from "@/lib/kv-store";
import {nextTheme,resolveStoredTheme,type AppTheme} from "@/lib/preferences";

const C=createContext<{theme:AppTheme;toggle:()=>void}>(null!);

export function ThemeProvider({children}:{children:React.ReactNode}){
  const system=useColorScheme();
  const [theme,setTheme]=useState<AppTheme>(resolveStoredTheme(null,system));
  useEffect(()=>{
    void kvGet("lotaya-theme").then((value)=>setTheme(resolveStoredTheme(value,system)));
  },[system]);
  const toggle=()=>setTheme((value)=>{
    const next=nextTheme(value);
    void kvSet("lotaya-theme",next);
    return next;
  });
  return <C.Provider value={{theme,toggle}}>{children}</C.Provider>;
}

export const useTheme=()=>useContext(C);
