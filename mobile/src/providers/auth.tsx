import {createContext,useContext,useEffect,useState} from "react";
import {api,onUnauthorized,refreshSession} from "@/lib/api";
import {requireVerifiedUser} from "@/lib/auth-response";
import {clearAccessToken,getRefreshToken,restoreAccessToken,restoreRefreshToken,saveRememberedIdentifier,setAccessToken,setRefreshToken} from "@/lib/session-store";

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
    (async()=>{
      const access=await restoreAccessToken();
      const refresh=await restoreRefreshToken();
      if(!access&&refresh){
        const refreshed=await refreshSession();
        if(!refreshed){
          await clearAccessToken();
          return;
        }
      }else if(!access){
        return;
      }
      try{
        const result=await api<User>("/auth/verify");
        if(active)setUser(requireVerifiedUser(result.data));
      }catch{
        await clearAccessToken();
        if(active)setUser(null);
      }
    })().finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[]);

  useEffect(()=>onUnauthorized(()=>{setUser(null)}),[]);

  const signIn=async(identifier:string,password:string,remember:boolean)=>{
    const result=await api<{user:User;accessToken:string;refreshToken?:string}>("/auth/login",{
      method:"POST",
      body:JSON.stringify({identifier:identifier.trim(),password}),
    });
    await setAccessToken(result.data.accessToken);
    if(result.data.refreshToken)await setRefreshToken(result.data.refreshToken);
    await saveRememberedIdentifier(identifier,remember);
    setUser(result.data.user);
  };

  const signOut=async()=>{
    const refreshToken=await getRefreshToken();
    try{
      await api("/auth/logout",{
        method:"POST",
        body:JSON.stringify(refreshToken?{refreshToken}:{}),
      });
    }
    finally{await clearAccessToken();setUser(null)}
  };

  return <C.Provider value={{user,loading,signIn,signOut}}>{children}</C.Provider>;
}

export const useAuth=()=>useContext(C);
