export function shouldRetryQuery(failureCount:number,error:unknown):boolean{
  const status=typeof error==="object"&&error!==null&&"status" in error?Number((error as {status:unknown}).status):undefined;
  if(status===401||status===403||status===404)return false;
  return failureCount<2;
}
