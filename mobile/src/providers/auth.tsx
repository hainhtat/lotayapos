import {createContext,useContext,useEffect,useState} from "react";
import {api,onUnauthorized,refreshSession} from "@/lib/api";
import {requireRiderUser} from "@/lib/auth-response";
import {clearAccessToken,getRefreshToken,restoreAccessToken,restoreRefreshToken,saveRememberedIdentifier,setAccessToken,setRefreshToken} from "@/lib/session-store";
import {useQueryClient} from "@tanstack/react-query";
import {i18n} from "@/i18n";

export type User={id:string;name:string;username?:string;email:string;phone?:string|null;role:string};
type Auth={
  user:User|null;
  loading:boolean;
  signIn:(identifier:string,password:string,remember:boolean)=>Promise<void>;
  signOut:()=>Promise<void>;
};
const C=createContext<Auth>(null!);

export function AuthProvider({children}:{children:React.ReactNode}){
  const queryClient=useQueryClient();
  const [user,setUser]=useState<User|null>(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let active=true;
    (async()=>{
      const access=await restoreAccessToken();
      const refresh=await restoreRefreshToken();
      try{
        if(!access){
          if(!refresh)return;
          const refreshed=await refreshSession();
          if(!refreshed){
            await clearAccessToken();
            return;
          }
        }
        const result=await api<User>("/auth/verify");
        if(active)setUser(requireRiderUser(result.data));
      }catch{
        if(refresh){
          const refreshed=await refreshSession();
          if(refreshed){
            try{
              const result=await api<User>("/auth/verify");
              if(active)setUser(requireRiderUser(result.data));
              return;
            }catch{
              // Fall through to clearing the stale session.
            }
          }
        }
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
      body:JSON.stringify({identifier:identifier.trim(),password,remember}),
    });
    try{
      const rider=requireRiderUser(result.data.user);
      await setAccessToken(result.data.accessToken);
      if(result.data.refreshToken)await setRefreshToken(result.data.refreshToken);
      await saveRememberedIdentifier(identifier,remember);
      setUser(rider);
    }catch(error){
      await clearAccessToken();
      if(error instanceof Error&&error.message==="RIDER_ROLE_REQUIRED")throw new Error(i18n.t("riderOnly"));
      throw error;
    }
  };

  const signOut=async()=>{
    const refreshToken=await getRefreshToken();
    try{
      await api("/auth/logout",{
        method:"POST",
        body:JSON.stringify(refreshToken?{refreshToken}:{}),
      });
    }
    finally{await clearAccessToken();queryClient.clear();setUser(null)}
  };

  return <C.Provider value={{user,loading,signIn,signOut}}>{children}</C.Provider>;
}

export const useAuth=()=>useContext(C);
