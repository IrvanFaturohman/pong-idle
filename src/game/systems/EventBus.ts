import Phaser from 'phaser';
import type { Side } from '../types';

/** Every cross-scene event and its payload. */
export interface BusEvents {
  /** A paddle hit paid out. */
  'paddle-hit': [amount: number, x: number, y: number, level: number];
  /** Player dragged a paddle a meaningful distance. */
  'paddle-dragged': [];
  /** Player tapped the open arena to speed the game up (target multiplier). */
  'speed-boost': [multiplier: number];
  'ball-added': [];
  'paddle-added': [side: Side];
  'merge-started': [level: number];
  'merged': [newLevel: number];
  /** Wallet decreased because of a purchase. */
  'spent': [amount: number];
  /** Map target reached. `final` = first clear of the last map. */
  'map-complete': [mapIndex: number, final: boolean, endlessTier: number];
  /** A new map (or endless tier) became active. */
  'map-entered': [mapIndex: number, endlessTier: number];
  /** Show the prototype complete panel. */
  'prototype-complete': [];
  'settings-changed': [];
  'lock-changed': [locked: boolean];
  /** UI asked to pulse the merge button (e.g. arena full). */
  'attention-merge': [];
}

type Listener<K extends keyof BusEvents> = (...args: BusEvents[K]) => void;

class TypedBus {
  private readonly emitter = new Phaser.Events.EventEmitter();

  on<K extends keyof BusEvents>(event: K, fn: Listener<K>, context?: unknown): void {
    this.emitter.on(event, fn as (...args: unknown[]) => void, context);
  }

  off<K extends keyof BusEvents>(event: K, fn: Listener<K>, context?: unknown): void {
    this.emitter.off(event, fn as (...args: unknown[]) => void, context);
  }

  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): void {
    this.emitter.emit(event, ...args);
  }

  /** Remove every listener registered with the given context (used on scene shutdown). */
  offContext(context: unknown): void {
    for (const name of this.emitter.eventNames()) {
      const listeners = this.emitter.listeners(name);
      for (const l of listeners) this.emitter.off(name, l, context);
    }
  }
}

export const bus = new TypedBus();
