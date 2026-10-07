// The actions layer (4.6). Every change to data — from a button or from the
// Assistant — goes through one of these. Add new actions to ACTIONS.
import type { ActionDef } from './types';
import { adjustStock } from './stock';

export const ACTIONS = {
  adjustStock,
};
// every entry must be an action definition
const _check: Record<string, ActionDef<never, unknown>> = ACTIONS as unknown as Record<
  string,
  ActionDef<never, unknown>
>;
void _check;

export type ActionName = keyof typeof ACTIONS;
export type ActionInput<N extends ActionName> = Parameters<(typeof ACTIONS)[N]['plan']>[1];

export * from './types';
export * from './run';
