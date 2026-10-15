"use client";
import {useCallback,useEffect,useReducer,useState} from 'react';
import {useAppAuth} from '@/context/auth-context';
import {authorizedFetch} from '@/lib/api-client';
import {loadScopedWorkOrders,requestDutyJson,schedulingEnabled,type ScopedWorkOrder} from './duty-scheduling';

export function useDutySchedulingEnabled() {
  const {userRole,stateCode}=useAppAuth();
  const [flag,setFlag]=useState<{scope:string;enabled:boolean}|null>(null);
  const scope=`${userRole}:${stateCode}`;
  useEffect(()=> {
    let active=true;
    void requestDutyJson<unknown>('/api/mobile/settings',{},authorizedFetch).then(payload=>{if(active)setFlag({scope,enabled:schedulingEnabled(payload)});}).catch(()=>{if(active)setFlag({scope,enabled:true});});
    return ()=>{active=false;};
  },[scope]);
  return flag?.scope===scope?flag.enabled:true;
}

export type ScopedDutyOrdersState = {
  orders: ScopedWorkOrder[];
  loading: boolean;
  error: string;
};

type ScopedDutyOrdersAction =
  | {type:'disabled'}
  | {type:'loading'}
  | {type:'loaded';orders:ScopedWorkOrder[]}
  | {type:'failed';error:string};

export function scopedDutyOrdersReducer(
  state:ScopedDutyOrdersState,
  action:ScopedDutyOrdersAction,
):ScopedDutyOrdersState {
  switch(action.type) {
    case 'disabled': return {orders:[],loading:false,error:''};
    case 'loading': return {...state,loading:true,error:''};
    case 'loaded': return {orders:action.orders,loading:false,error:''};
    case 'failed': return {orders:[],loading:false,error:action.error};
  }
}

export function useScopedDutyOrders(enabled:boolean) {
  const {userRole}=useAppAuth();
  const [state,dispatch]=useReducer(scopedDutyOrdersReducer,{orders:[],loading:false,error:''});
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(r=>r+1),[]);
  useEffect(()=> {
    let active=true;
    if(!enabled || !['fieldOfficer','admin','superAdmin'].includes(userRole || '')) {dispatch({type:'disabled'});return;}
    dispatch({type:'loading'});
    void loadScopedWorkOrders(authorizedFetch).then(orders=>{if(active)dispatch({type:'loaded',orders});}).catch(e=>{if(active)dispatch({type:'failed',error:e instanceof Error?e.message:'Could not load duty responses.'});});
    return ()=>{active=false;};
  },[enabled,userRole,revision]);
  return {...state,reload};
}
