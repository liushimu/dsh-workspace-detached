/** Bounded JSON messages for the workspace navigator; no executable or backend state crosses this IPC. */
/** Complete card projection owned by this independent plugin, including localized copy. */
export interface WorkspaceNavigatorModel {
    readonly version: 3;
    readonly sortMode: 'activity' | 'manual';
    readonly contextMenu?: WorkspaceNavigatorMenu;
    readonly dialog?: WorkspaceNavigatorDialog;
    readonly operation?: {
        readonly id: string;
        readonly status: 'pending' | 'success' | 'error';
        readonly message: string;
    };
    /** One Main-authorized exact Session ID write in the fixed foreground document, not a business action. */
    readonly clipboard?: {
        readonly id: string;
        readonly text: string;
    };
    readonly instance: string;
    readonly revision: number;
    readonly title: string;
    readonly query: string;
    readonly dark: boolean;
    readonly connected: boolean;
    readonly lang: string;
    readonly direction: 'ltr' | 'rtl';
    readonly density: 'compact' | 'comfortable' | 'roomy';
    readonly labels: {
        readonly search: string;
        readonly return: string;
        readonly empty: string;
        readonly disconnected: string;
        readonly error: string;
        readonly warning: string;
        readonly ongoing: string;
        readonly done: string;
        readonly overview: string;
        readonly searchResults: string;
        readonly noSessions: string;
        readonly pinned: string;
        readonly activityUnavailable: string;
        readonly menu?: string;
        readonly cancel?: string;
        readonly submit?: string;
        readonly automatic?: string;
        readonly manual?: string;
        readonly sort?: string;
        readonly pending?: string;
        readonly invalidDrop?: string;
        readonly color?: string;
        readonly glow?: string;
        readonly weight?: string;
        readonly shadow?: string;
        readonly stroke?: string;
        readonly strokeWidth?: string;
        readonly strokeColor?: string;
        readonly icon?: string;
        readonly reset?: string;
        readonly auto?: string;
        readonly iconSolid?: string;
        readonly iconOutline?: string;
        readonly iconNone?: string;
    };
    readonly workspaces: readonly WorkspaceNavigatorWorkspace[];
    readonly layout: WorkspaceNavigatorLayout;
}
/** Persisted navigator-only preferences; scroll IDs address overview, strip, or one workspace. */
export interface WorkspaceNavigatorLayout {
    readonly focusedWorkspaceId: string | null;
    readonly collapsedGroups: readonly string[];
    readonly scrolls: readonly {
        readonly id: string;
        readonly top: number;
    }[];
}
/** Styles admitted by both the renderer and the wire validator. */
export interface WorkspaceNavigatorStyle {
    readonly color?: string;
    readonly fontWeight?: string | number;
    readonly textShadow?: string;
    readonly WebkitTextStrokeWidth?: string;
    readonly WebkitTextStrokeColor?: string;
}
/** One top-level branch, with real workspaces and groups kept as explicit containers. */
export interface WorkspaceNavigatorWorkspace {
    readonly id: string;
    readonly kind?: 'workspace' | 'workspace-group';
    readonly label: string;
    readonly title: string;
    readonly activityAt: number | null;
    /** False when at least one member's content projection has not been materialized. */
    readonly activityKnown: boolean;
    readonly matches: boolean;
    readonly rows: readonly WorkspaceNavigatorRow[];
    readonly icon?: string;
    readonly style?: WorkspaceNavigatorStyle;
}
/** Display data only; session IDs address the main document's revalidated open actions. */
export interface WorkspaceNavigatorRow {
    readonly id: string;
    readonly kind: 'workspace' | 'workspace-group' | 'group' | 'session';
    readonly workspaceId?: string;
    readonly label: string;
    readonly title: string;
    readonly depth: number;
    readonly activityAt: number | null;
    /** Separates a known empty history from an unavailable historical projection. */
    readonly activityKnown: boolean;
    readonly matches: boolean;
    readonly expanded?: boolean;
    readonly selected?: boolean;
    readonly disabled?: boolean;
    readonly status?: 'warning' | 'ongoing' | 'done';
    readonly icon?: string;
    readonly style?: WorkspaceNavigatorStyle;
    readonly count?: number;
    readonly pinned?: boolean;
}
export interface WorkspaceNavigatorAppearance {
    readonly color?: string;
    readonly glow?: number;
    readonly weight?: number;
    readonly shadow?: boolean;
    readonly stroke?: boolean;
    readonly strokeWidth?: number;
    readonly strokeColor?: string;
    readonly icon?: string;
}
export interface WorkspaceNavigatorMenu {
    readonly id: string;
    readonly targetId: string;
    readonly title: string;
    readonly entries: readonly {
        readonly id: string;
        readonly label: string;
        readonly disabled?: boolean;
        readonly danger?: boolean;
        readonly separator?: boolean;
    }[];
}
export interface WorkspaceNavigatorDialog {
    readonly id: string;
    readonly title: string;
    readonly kind: 'text' | 'confirm' | 'select' | 'appearance';
    readonly message?: string;
    readonly value?: string;
    readonly options?: readonly {
        readonly id: string;
        readonly label: string;
        readonly disabled?: boolean;
    }[];
    readonly appearance?: WorkspaceNavigatorAppearance;
}
/** Finite interaction intents; the originating Main remains the sole business executor. */
export type WorkspaceNavigatorCommand = {
    readonly instance: string;
    readonly revision: number;
    readonly commandId: string;
} & ({
    readonly type: 'activate';
    readonly id: string;
} | {
    readonly type: 'search';
    readonly query: string;
} | {
    readonly type: 'layout';
    readonly layout: WorkspaceNavigatorLayout;
} | {
    readonly type: 'return';
} | {
    readonly type: 'context';
    readonly id: string;
} | {
    readonly type: 'action';
    readonly id: string;
    readonly action: string;
} | {
    readonly type: 'dialog';
    readonly id: string;
    readonly value?: string;
    readonly appearance?: WorkspaceNavigatorAppearance;
} | {
    readonly type: 'cancel-dialog';
    readonly id: string;
} | {
    readonly type: 'drop';
    readonly id: string;
    readonly targetId: string | null;
    readonly position: 'inside' | 'before' | 'after';
} | {
    readonly type: 'sort';
    readonly mode: 'activity' | 'manual';
} | {
    readonly type: 'clipboard-result';
    readonly id: string;
    readonly outcome: 'copied' | 'unavailable' | 'denied' | 'failed';
});
/** Detached is emitted only after the loaded auxiliary document acknowledges rendering its model. */
export type WorkspaceNavigatorEvent = {
    readonly kind: 'state';
    readonly state: 'opening' | 'detached' | 'closed' | 'error';
    readonly code?: string;
} | {
    readonly kind: 'command';
    readonly command: WorkspaceNavigatorCommand;
};
/** Product API does not expose URLs, Electron objects, IPC channel selection, or window options. */
export interface WorkspaceNavigatorMainBridge {
    readonly protocolVersion: 3;
    /**
     * @param model - Initial projection; repeating the same instance/revision focuses the existing window.
     * @returns Ready/rendered completion; rejects after contained load failure or cancellation.
     */
    open(model: WorkspaceNavigatorModel): Promise<void>;
    /**
     * @param model - Changed projection with a strictly increasing revision in the open instance; close before replacing the instance.
     * @returns Delivery admission, not a business-action acknowledgement; rejects stale or closed-instance updates.
     */
    publish(model: WorkspaceNavigatorModel): Promise<void>;
    /** @returns Focus completion for the existing navigator; never creates a window. */
    focus(): Promise<void>;
    /** @returns Closure completion; the main sidebar owner receives closed even while opening. */
    close(): Promise<void>;
    /** @param listener - State/intent observer. @returns Idempotent unsubscribe function. */
    subscribe(listener: (event: WorkspaceNavigatorEvent) => void): () => void;
}
/** Stale or disconnected intent never executes; the auxiliary document keeps an actionable readable projection. */
export type WorkspaceNavigatorCommandResult = {
    readonly kind: 'accepted';
} | {
    readonly kind: 'refresh' | 'disconnected';
    readonly model: WorkspaceNavigatorModel;
};
/** Rendering acknowledgement carries no data besides the displayed projection identity. */
export interface WorkspaceNavigatorRendered {
    readonly instance: string;
    readonly revision: number;
}
/** Narrow bridge available only to the fixed auxiliary document, never the product API. */
export interface WorkspaceNavigatorAuxApi {
    /** @returns Current model after subscription is installed; does not mark the window detached. */
    ready(): Promise<WorkspaceNavigatorModel>;
    /** @param value - Projection already applied to the document; stale acknowledgements request a refresh. */
    rendered(value: WorkspaceNavigatorRendered): Promise<void>;
    /** @param value - Observed projection and finite intent. @returns Admission or latest model without executing stale intent. */
    command(value: WorkspaceNavigatorCommand): Promise<WorkspaceNavigatorCommandResult>;
    /** @param listener - Projection observer. @returns Unsubscribe function for document teardown. */
    subscribe(listener: (model: WorkspaceNavigatorModel) => void): () => void;
}
/** Stable diagnostic classes contain no untrusted labels, IDs, paths, or IPC payloads. */
export declare class WorkspaceNavigatorError extends Error {
    readonly code: 'invalid' | 'unowned' | 'stale' | 'unavailable' | 'load-failed' | 'cancelled';
    constructor(code: 'invalid' | 'unowned' | 'stale' | 'unavailable' | 'load-failed' | 'cancelled');
}
/**
 * Validate a deliberately restricted SVG grammar, including balanced tags and unique attributes.
 * @param value - Inline SVG without entities, comments, links, style, text nodes, or external resources.
 * @returns Whether the geometry-only icon may be reconstructed by the auxiliary renderer.
 */
export declare function isWorkspaceNavigatorIcon(value: unknown): value is string;
/**
 * Parse complete trees at the wire boundary; at most 10,000 cards plus rows and 4 MiB UTF-8.
 * @param value - Untrusted structured-clone input.
 * @returns Validated data; rejects unknown fields, invalid preorder parents, duplicate IDs, and unsafe styles/icons.
 */
export declare function parseWorkspaceNavigatorModel(value: unknown): WorkspaceNavigatorModel;
/** @param value - Untrusted auxiliary intent. @returns Exact, bounded, type-specific command fields. */
export declare function parseWorkspaceNavigatorCommand(value: unknown): WorkspaceNavigatorCommand;
/** @param value - Untrusted displayed-model identity. @returns Exact acknowledgement fields. */
export declare function parseWorkspaceNavigatorRendered(value: unknown): WorkspaceNavigatorRendered;
/** @param value - Main-process notification. @returns Validated state or command with no extra fields. */
export declare function parseWorkspaceNavigatorEvent(value: unknown): WorkspaceNavigatorEvent;
/** @param value - Reply to auxiliary intent. @returns Accepted intent or a readable non-executed refresh. */
export declare function parseWorkspaceNavigatorCommandResult(value: unknown): WorkspaceNavigatorCommandResult;
