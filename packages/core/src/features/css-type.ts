import { createFeature, SelectorNodeContext } from './feature';
import type { StylableDirectives, ImportSymbol } from './types';
import { generalDiagnostics } from './diagnostics';
import * as STSymbol from './st-symbol';
import * as CSSClass from './css-class';
import { plugableRecord } from '../helpers/plugable-record';
import type { StylableMeta } from '../stylable-meta';
import type { ScopeContext } from '../stylable-transformer';
import { isCompRoot, stringifySelector } from '../helpers/selector';
import { getOriginDefinition } from '../helpers/resolve';
import { ignoreDeprecationWarn } from '../helpers/deprecation';
import type { Type, ImmutableType, ImmutableSelectorNode } from '@tokey/css-selector-parser';
import type * as postcss from 'postcss';

export interface ElementSymbol extends StylableDirectives {
    _kind: 'element';
    name: string;
    alias?: ImportSymbol;
}

const dataKey = plugableRecord.key<Record<string, ElementSymbol>>();

export const diagnostics = {
    INVALID_FUNCTIONAL_SELECTOR: generalDiagnostics.INVALID_FUNCTIONAL_SELECTOR,
    UNSCOPED_TYPE_SELECTOR(name: string) {
        return `unscoped type selector "${name}" will affect all elements of the same type in the document`;
    },
};

// HOOKS

export const hooks = createFeature({
    analyzeInit({ data }) {
        plugableRecord.set(data, dataKey, {});
    },
    analyzeSelectorNode<AST extends ImmutableType>(
        meta: StylableMeta,
        node: AST,
        rule: postcss.Rule,
        [_index, _nodes, parents]: SelectorNodeContext
    ): void {
        /**
         * intent to deprecate: currently `value(param)` can be used
         * as a custom state value. Unless there is a reasonable
         * use case, this should be removed.
         */
        if (
            node.nodes &&
            (parents.length < 2 ||
                parents[parents.length - 2].type !== `pseudo_class` ||
                node.value !== `value`)
        ) {
            // error on functional type
            meta.diagnostics.error(
                rule,
                diagnostics.INVALID_FUNCTIONAL_SELECTOR(node.value, `type`),
                { word: stringifySelector(node) }
            );
        }
        addType(meta, node.value, rule);
    },
    transformSelectorNode<AST extends Type>(context: Required<ScopeContext>, node: AST): void {
        const resolved = context.metaParts.element[node.value] || [
            // provides resolution for native elements
            // that are not collected by parts
            // or elements that are added by js mixin
            {
                _kind: 'css',
                meta: context.originMeta,
                symbol: { _kind: 'element', name: node.value },
            },
        ];
        context.setCurrentAnchor({ name: node.value, type: 'element', resolved });
        // native node does not resolve e.g. div
        if (resolved && resolved.length > 1) {
            const { symbol, meta } = getOriginDefinition(resolved);
            CSSClass.namespaceClass(meta, symbol, node, context.originMeta);
        }
    },
});

// API

export function get({ data }: StylableMeta, name: string): ElementSymbol | undefined {
    const state = plugableRecord.getUnsafe(data, dataKey);
    return state[name];
}

export function getAll({ data }: StylableMeta): Record<string, ElementSymbol> {
    return plugableRecord.getUnsafe(data, dataKey);
}

export function addType(meta: StylableMeta, name: string, rule?: postcss.Rule): ElementSymbol {
    const cssTypeData = plugableRecord.getUnsafe(meta.data, dataKey);
    let typeSymbol = cssTypeData[name];
    if (!typeSymbol && isCompRoot(name)) {
        let alias = STSymbol.get(meta, name);
        if (alias && alias._kind !== 'import') {
            alias = undefined;
        }
        typeSymbol = cssTypeData[name] = {
            _kind: 'element',
            name,
            alias,
        };
        STSymbol.addSymbol({
            meta,
            symbol: typeSymbol,
            node: rule,
            safeRedeclare: !!alias,
        });
        // deprecated
        ignoreDeprecationWarn(() => {
            meta.elements[name] = typeSymbol;
        });
    }
    return typeSymbol;
}

export function validateTypeScoping(
    meta: StylableMeta,
    {
        locallyScoped,
        inStScope,
        node,
        nodes,
        index,
        rule,
    }: {
        locallyScoped: boolean;
        inStScope: boolean;
        node: ImmutableType;
        nodes: ImmutableSelectorNode[];
        index: number;
        rule: postcss.Rule;
    }
): boolean {
    if (locallyScoped === false && !inStScope) {
        if (CSSClass.checkForScopedNodeAfter(rule, meta, nodes, index) === false) {
            meta.diagnostics.warn(rule, diagnostics.UNSCOPED_TYPE_SELECTOR(node.value), {
                word: node.value,
            });
            return false;
        } else {
            locallyScoped = true;
        }
    }
    return locallyScoped;
}
