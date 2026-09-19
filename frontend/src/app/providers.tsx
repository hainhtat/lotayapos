import {MutationCache,QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ToastContainer} from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {AuthProvider} from "./auth";
import {ThemeProvider,useTheme} from "./theme";
import {notifyError} from "@/lib/notifications";

export function createAppQueryClient(){return new QueryClient({mutationCache:new MutationCache({onError:notifyError}),defaultOptions:{queries:{staleTime:30000,retry:(count,error)=>count<1 && !(error instanceof Error && "status" in error && (error as {status?:number}).status===401)}}})}
const client=createAppQueryClient();

function Notifications(){const {resolved}=useTheme();return <ToastContainer position="top-right" newestOnTop limit={4} autoClose={6000} closeOnClick pauseOnFocusLoss pauseOnHover theme={resolved} aria-label="Notifications" />}

export function AppProviders({children}:{children:React.ReactNode}){return <ThemeProvider><QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider><Notifications/></QueryClientProvider></ThemeProvider>}
