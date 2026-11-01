'use strict';

/**
 * local/use-client-exports
 *
 * In a module whose first statement is the `'use client'` directive, every
 * named export must be:
 *   - a component (PascalCase identifier), or
 *   - a React hook (`use` + PascalCase), or
 *   - a type/interface (`export type` / `export interface` / type-only specifiers).
 *
 * Helpers belong in a module without the directive so Server Components can
 * import them (hoard #450: `latestTimestamp` leaked from DataStatus.tsx).
 *
 * Grammar:
 *   - `export function X` / `export const X =` — X must be PascalCase or useXxx
 *   - `export { a, b as C }` — the *exported* name is checked (`C`, not `b`)
 *   - `export default` — allowed (any local name)
 *   - `export type` / `export interface` / `export { type x }` — allowed
 *   - `export { x } from '...'` — same named-export rule on the exported name
 *   - `export * from '...'` and `export * as ns from '...'` — always flagged
 *     (fail-closed: this rule cannot see the re-exported names)
 *
 * A file whose first statement is not `'use client'` is never checked.
 * React hooks are allowed because they are the client-module counterpart of
 * components (they cannot be PascalCase and cannot live in a Server module).
 *
 * @type {import('eslint').Rule.RuleModule}
 */

const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const REACT_HOOK = /^use[A-Z][a-zA-Z0-9]*$/;

function isAllowedExportName(name) {
  return PASCAL_CASE.test(name) || REACT_HOOK.test(name);
}

function isUseClientDirective(node) {
  if (!node || node.type !== 'ExpressionStatement') {
    return false;
  }
  const expr = node.expression;
  return expr.type === 'Literal' && expr.value === 'use client';
}

function isUseClientModule(program) {
  return isUseClientDirective(program.body[0]);
}

function collectBoundNames(pattern, out) {
  if (!pattern) {
    return;
  }
  switch (pattern.type) {
    case 'Identifier':
      out.push({ node: pattern, name: pattern.name });
      return;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          collectBoundNames(prop.argument, out);
        } else if (prop.type === 'Property') {
          collectBoundNames(prop.value, out);
        }
      }
      return;
    case 'ArrayPattern':
      for (const el of pattern.elements) {
        collectBoundNames(el, out);
      }
      return;
    case 'AssignmentPattern':
      collectBoundNames(pattern.left, out);
      return;
    case 'RestElement':
      collectBoundNames(pattern.argument, out);
      return;
    default:
      return;
  }
}

function exportedName(exported) {
  if (!exported) {
    return null;
  }
  if (exported.type === 'Identifier') {
    return { node: exported, name: exported.name };
  }
  if (exported.type === 'Literal') {
    return { node: exported, name: String(exported.value) };
  }
  return null;
}

function reportIfDisallowed(context, node, name) {
  if (name === 'default') {
    return;
  }
  if (isAllowedExportName(name)) {
    return;
  }
  context.report({ node, messageId: 'nonComponentExport', data: { name } });
}

function isTypeOnlyDeclaration(decl) {
  if (!decl) {
    return false;
  }
  return decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration';
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require named exports from a 'use client' module to be components (PascalCase), React hooks (useXxx), or types. Helpers belong in a module without the directive. `export *` is flagged (fail-closed). `export default` is allowed.",
    },
    schema: [],
    messages: {
      nonComponentExport:
        "Named export '{{name}}' from a 'use client' module must be a component (PascalCase), a React hook (useXxx), or a type. Move helpers to a module without the 'use client' directive.",
      exportAll:
        "Do not `export *` from a 'use client' module (fail-closed: re-exported names are not visible to this rule). Re-export named components, hooks, or types explicitly.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (!isUseClientModule(sourceCode.ast)) {
      return {};
    }
    return {
      ExportAllDeclaration(node) {
        context.report({ node, messageId: 'exportAll' });
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type') {
          return;
        }
        if (node.declaration) {
          const decl = node.declaration;
          if (isTypeOnlyDeclaration(decl)) {
            return;
          }
          if (
            decl.type === 'FunctionDeclaration' ||
            decl.type === 'TSDeclareFunction' ||
            decl.type === 'ClassDeclaration' ||
            decl.type === 'TSEnumDeclaration'
          ) {
            if (decl.id && decl.id.type === 'Identifier') {
              reportIfDisallowed(context, decl.id, decl.id.name);
            }
            return;
          }
          if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) {
              const bound = [];
              collectBoundNames(d.id, bound);
              for (const b of bound) {
                reportIfDisallowed(context, b.node, b.name);
              }
            }
            return;
          }
          if (decl.id && decl.id.type === 'Identifier') {
            reportIfDisallowed(context, decl.id, decl.id.name);
          }
          return;
        }
        for (const spec of node.specifiers) {
          if (spec.exportKind === 'type') {
            continue;
          }
          if (spec.type !== 'ExportSpecifier') {
            continue;
          }
          const info = exportedName(spec.exported);
          if (!info) {
            continue;
          }
          reportIfDisallowed(context, info.node, info.name);
        }
      },
    };
  },
};

module.exports = rule;
