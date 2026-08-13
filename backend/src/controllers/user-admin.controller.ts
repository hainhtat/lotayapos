import type { RequestHandler } from "express";
import * as service from "../services/user-admin.service.js";
const actor=(req:Parameters<RequestHandler>[0])=>({id:req.auth!.sub,role:req.auth!.role});
export const listUsers:RequestHandler=async(req,res)=>res.json({success:true,data:await service.listUsers({page:Number(req.query.page??1),pageSize:Number(req.query.pageSize??25),search:req.query.search as string|undefined,role:req.query.role as string|undefined,active:req.query.active===undefined?undefined:req.query.active==="true",hubId:req.query.hubId as string|undefined},actor(req))});
export const createUser:RequestHandler=async(req,res)=>res.status(201).json({success:true,data:await service.createUser(req.body,actor(req))});
export const updateUser:RequestHandler=async(req,res)=>res.json({success:true,data:await service.updateUser(String(req.params.id),req.body,actor(req))});
export const setUserActive:RequestHandler=async(req,res)=>res.json({success:true,data:await service.setUserActive(String(req.params.id),req.body.active,actor(req))});
export const resetUserPassword:RequestHandler=async(req,res)=>res.json({success:true,data:await service.resetUserPassword(String(req.params.id),req.body.password,actor(req))});
