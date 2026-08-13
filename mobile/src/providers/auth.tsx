import {createContext,useContext,useEffect,useState} from "react";
import {api,onUnauthorized} from "@/lib/api";
import {requireVerifiedUser} from "@/lib/auth-response";
import {clearAccessToken,restoreAccessToken,saveRememberedIdentifier,setAccessToken} from "@/lib/session-store";

export type User={id:string;name:string;email:string;role:string};
type Auth={
  user:User|null;
  loading:boolean;
  signIn:(identifier:string,password:string,remember:boolean)=>Promise<void>;
  signOut:()=>Promise<void>;
};
const C=createContext<Auth>(null!);

export function AuthProvider({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<User|null>(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let active=true;
    restoreAccessToken().then(async token=>{
      if(!token)return;
      try{
        const result=await api<User>("/auth/verify");
        if(active)setUser(requireVerifiedUser(result.data));
      }catch{
        await clearAccessToken();
        if(active)setUser(null);
      }
    }).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  useEffect(()=>onUnauthorized(()=>{setUser(null)}),[]);

  const signIn=async(identifier:string,password:string,remember:boolean)=>{
    const result=await api<{user:User;accessToken:string}>("/auth/login",{
      method:"POST",
      body:JSON.stringify({identifier:identifier.trim(),password}),
    });
    await setAccessToken(result.data.accessToken);
    await saveRememberedIdentifier(identifier,remember);
    setUser(result.data.user);
  };

  const signOut=async()=>{
    try{await api("/auth/logout",{method:"POST"})}
    finally{await clearAccessToken();setUser(null)}
  };

  return <C.Provider value={{user,loading,signIn,signOut}}>{children}</C.Provider>;
}

export const useAuth=()=>useContext(C);
