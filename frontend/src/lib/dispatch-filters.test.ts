import {describe,expect,it} from "vitest";
import {dispatchFiltersFromSearch,dispatchFiltersToSearch,emptyDispatchFilters} from "./dispatch-filters";

describe("dispatch filters",()=>{it("round-trips active filters and locks focused workspace queues",()=>{const filters={...emptyDispatchFilters,batchId:"batch-1",status:"DELIVERED"};expect(dispatchFiltersToSearch(filters).toString()).toBe("batchId=batch-1&status=DELIVERED");expect(dispatchFiltersFromSearch(new URLSearchParams("queue=overdue&batchId=batch-1"),"return-to-os")).toMatchObject({queue:"return-to-os",batchId:"batch-1"})})});
