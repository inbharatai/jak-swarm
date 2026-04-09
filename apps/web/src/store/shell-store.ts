import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { MosaicNode } from 'react-mosaic-component';

enableMapSet();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FloatingWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface ModuleInstance {
  moduleId: string;
  openedAt: number;
}

export interface ShellState {
  // Open module instances
  openModules: Map<string, ModuleInstance>;
  // Mosaic layout tree for tiled modules
  layoutTree: MosaicNode<string> | null;
  // Floating (popped-out) windows
  floatingWindows: Map<string, FloatingWindow>;
  // Minimized modules
  minimizedModules: Set<string>;
  // Currently focused module
  activeModuleId: string | null;
  // Dock icon order
  dockOrder: string[];
  // Next z-index for floating windows
  nextZIndex: number;
  // Shell ready state
  isReady: boolean;
}

export interface ShellActions {
  openModule: (moduleId: string) => void;
  closeModule: (moduleId: string) => void;
  minimizeModule: (moduleId: string) => void;
  restoreModule: (moduleId: string) => void;
  maximizeModule: (moduleId: string) => void;
  floatModule: (moduleId: string, bounds?: Partial<FloatingWindow>) => void;
  dockModule: (moduleId: string) => void;
  setActiveModule: (moduleId: string | null) => void;
  setLayoutTree: (tree: MosaicNode<string> | null) => void;
  updateFloatingWindow: (moduleId: string, bounds: Partial<FloatingWindow>) => void;
  bringToFront: (moduleId: string) => void;
  setDockOrder: (order: string[]) => void;
  setReady: (ready: boolean) => void;
  hydrateLayout: (state: Partial<SerializedLayout>) => void;
  applyPreset: (modules: string[], layoutTree: MosaicNode<string> | null) => void;
  reset: () => void;
}

// Serialization format for persistence
export interface SerializedLayout {
  layoutTree: MosaicNode<string> | null;
  floatingWindows: Record<string, FloatingWindow>;
  minimizedModules: string[];
  dockOrder: string[];
  openModuleIds: string[];
  activeModuleId: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addToMosaicTree(
  current: MosaicNode<string> | null,
  moduleId: string,
): MosaicNode<string> {
  if (!current) return moduleId;
  // Add as a right split child
  return {
    type: 'split' as const,
    direction: 'row' as const,
    children: [current, moduleId],
    splitPercentages: [70, 30],
  };
}

function removeFromMosaicTree(
  current: MosaicNode<string> | null,
  moduleId: string,
): MosaicNode<string> | null {
  if (!current) return null;
  if (typeof current === 'string') {
    return current === moduleId ? null : current;
  }
  if ('children' in current) {
    const filtered = current.children
      .map(child => removeFromMosaicTree(child, moduleId))
      .filter((child): child is MosaicNode<string> => child !== null);
    if (filtered.length === 0) return null;
    if (filtered.length === 1) return filtered[0];
    return { ...current, children: filtered, splitPercentages: undefined };
  }
  if ('tabs' in current) {
    const filtered = current.tabs.filter(t => t !== moduleId);
    if (filtered.length === 0) return null;
    if (filtered.length === 1) return filtered[0];
    return { ...current, tabs: filtered, activeTabIndex: Math.min(current.activeTabIndex, filtered.length - 1) };
  }
  return current;
}

function isInMosaicTree(
  node: MosaicNode<string> | null,
  moduleId: string,
): boolean {
  if (!node) return false;
  if (typeof node === 'string') return node === moduleId;
  if ('children' in node) return node.children.some(child => isInMosaicTree(child, moduleId));
  if ('tabs' in node) return node.tabs.includes(moduleId);
  return false;
}

// ─── Initial state ───────────────────────────────────────────────────────────

const initialState: ShellState = {
  openModules: new Map(),
  layoutTree: null,
  floatingWindows: new Map(),
  minimizedModules: new Set(),
  activeModuleId: null,
  dockOrder: [],
  nextZIndex: 100,
  isReady: false,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useShellStore = create<ShellState & ShellActions>()(
  subscribeWithSelector(
  immer((set, get) => ({
    ...initialState,

    openModule: (moduleId: string) => {
      set((state) => {
        // Already open — just focus
        if (state.openModules.has(moduleId)) {
          // If minimized, restore it
          state.minimizedModules.delete(moduleId);
          state.activeModuleId = moduleId;
          return;
        }

        state.openModules.set(moduleId, {
          moduleId,
          openedAt: Date.now(),
        });

        // Add to mosaic tree (tiled by default)
        state.layoutTree = addToMosaicTree(state.layoutTree, moduleId);
        state.activeModuleId = moduleId;
      });
    },

    closeModule: (moduleId: string) => {
      set((state) => {
        state.openModules.delete(moduleId);
        state.floatingWindows.delete(moduleId);
        state.minimizedModules.delete(moduleId);
        state.layoutTree = removeFromMosaicTree(state.layoutTree, moduleId);

        // Update active module
        if (state.activeModuleId === moduleId) {
          const remaining = Array.from(state.openModules.keys());
          state.activeModuleId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        }
      });
    },

    minimizeModule: (moduleId: string) => {
      set((state) => {
        if (!state.openModules.has(moduleId)) return;
        state.minimizedModules.add(moduleId);

        // Remove from tiling if tiled
        if (isInMosaicTree(state.layoutTree, moduleId)) {
          state.layoutTree = removeFromMosaicTree(state.layoutTree, moduleId);
        }

        // Remove from floating
        state.floatingWindows.delete(moduleId);

        // Update active
        if (state.activeModuleId === moduleId) {
          const visible = Array.from(state.openModules.keys()).filter(
            id => !state.minimizedModules.has(id),
          );
          state.activeModuleId = visible.length > 0 ? visible[visible.length - 1] : null;
        }
      });
    },

    restoreModule: (moduleId: string) => {
      set((state) => {
        state.minimizedModules.delete(moduleId);
        // Put back in mosaic tree
        if (!isInMosaicTree(state.layoutTree, moduleId) && !state.floatingWindows.has(moduleId)) {
          state.layoutTree = addToMosaicTree(state.layoutTree, moduleId);
        }
        state.activeModuleId = moduleId;
      });
    },

    maximizeModule: (moduleId: string) => {
      set((state) => {
        if (!state.openModules.has(moduleId)) return;
        // Make this the only tiled module
        state.layoutTree = moduleId;
        // Move all other tiled modules to minimized
        for (const id of state.openModules.keys()) {
          if (id !== moduleId && !state.floatingWindows.has(id)) {
            state.minimizedModules.add(id);
          }
        }
        state.activeModuleId = moduleId;
      });
    },

    floatModule: (moduleId: string, bounds?: Partial<FloatingWindow>) => {
      set((state) => {
        if (!state.openModules.has(moduleId)) return;

        // Remove from mosaic
        state.layoutTree = removeFromMosaicTree(state.layoutTree, moduleId);
        state.minimizedModules.delete(moduleId);

        const zIndex = state.nextZIndex;
        state.nextZIndex += 1;

        state.floatingWindows.set(moduleId, {
          x: bounds?.x ?? 100 + (state.floatingWindows.size * 30),
          y: bounds?.y ?? 100 + (state.floatingWindows.size * 30),
          width: bounds?.width ?? 800,
          height: bounds?.height ?? 600,
          zIndex,
        });

        state.activeModuleId = moduleId;
      });
    },

    dockModule: (moduleId: string) => {
      set((state) => {
        // Move from floating back to mosaic
        state.floatingWindows.delete(moduleId);
        if (!isInMosaicTree(state.layoutTree, moduleId)) {
          state.layoutTree = addToMosaicTree(state.layoutTree, moduleId);
        }
        state.activeModuleId = moduleId;
      });
    },

    setActiveModule: (moduleId: string | null) => {
      set((state) => {
        state.activeModuleId = moduleId;
      });
    },

    setLayoutTree: (tree: MosaicNode<string> | null) => {
      set((state) => {
        state.layoutTree = tree;
      });
    },

    updateFloatingWindow: (moduleId: string, bounds: Partial<FloatingWindow>) => {
      set((state) => {
        const existing = state.floatingWindows.get(moduleId);
        if (existing) {
          state.floatingWindows.set(moduleId, { ...existing, ...bounds });
        }
      });
    },

    bringToFront: (moduleId: string) => {
      set((state) => {
        const win = state.floatingWindows.get(moduleId);
        if (win) {
          const zIndex = state.nextZIndex;
          state.nextZIndex += 1;
          win.zIndex = zIndex;
        }
        state.activeModuleId = moduleId;
      });
    },

    setDockOrder: (order: string[]) => {
      set((state) => {
        state.dockOrder = order;
      });
    },

    setReady: (ready: boolean) => {
      set((state) => {
        state.isReady = ready;
      });
    },

    hydrateLayout: (serialized: Partial<SerializedLayout>) => {
      set((state) => {
        if (serialized.layoutTree !== undefined) {
          state.layoutTree = serialized.layoutTree;
        }
        if (serialized.floatingWindows) {
          state.floatingWindows = new Map(Object.entries(serialized.floatingWindows));
        }
        if (serialized.minimizedModules) {
          state.minimizedModules = new Set(serialized.minimizedModules);
        }
        if (serialized.dockOrder) {
          state.dockOrder = serialized.dockOrder;
        }
        if (serialized.openModuleIds) {
          for (const id of serialized.openModuleIds) {
            if (!state.openModules.has(id)) {
              state.openModules.set(id, { moduleId: id, openedAt: Date.now() });
            }
          }
        }
        if (serialized.activeModuleId !== undefined) {
          state.activeModuleId = serialized.activeModuleId;
        }
        state.isReady = true;
      });
    },

    applyPreset: (modules: string[], layoutTree: MosaicNode<string> | null) => {
      set((state) => {
        state.openModules = new Map(
          modules.map(id => [id, { moduleId: id, openedAt: Date.now() }]),
        );
        state.layoutTree = layoutTree;
        state.floatingWindows = new Map();
        state.minimizedModules = new Set();
        state.activeModuleId = modules[0] ?? null;
        state.dockOrder = modules;
      });
    },

    reset: () => {
      set(() => ({
        openModules: new Map(),
        layoutTree: null,
        floatingWindows: new Map(),
        minimizedModules: new Set(),
        activeModuleId: null,
        dockOrder: [],
        nextZIndex: 100,
        isReady: false,
      }));
    },
  })),
  ),
);

// ─── Serialization helpers ───────────────────────────────────────────────────

export function serializeLayout(): SerializedLayout {
  const state = useShellStore.getState();
  return {
    layoutTree: state.layoutTree,
    floatingWindows: Object.fromEntries(state.floatingWindows),
    minimizedModules: Array.from(state.minimizedModules),
    dockOrder: state.dockOrder,
    openModuleIds: Array.from(state.openModules.keys()),
    activeModuleId: state.activeModuleId,
  };
}
