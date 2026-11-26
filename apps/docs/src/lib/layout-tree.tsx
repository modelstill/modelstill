import type * as PageTree from "fumadocs-core/page-tree";
import { Books } from "@phosphor-icons/react/ssr";

export function withDocumentationTab(tree: PageTree.Root): PageTree.Root {
  const isTab = (node: PageTree.Node) => node.type === "folder" && node.root === true;
  const rest = tree.children.filter((node) => !isTab(node));
  while (rest.length && rest[rest.length - 1]!.type === "separator") rest.pop();

  const documentation: PageTree.Folder = {
    type: "folder",
    $id: "documentation",
    name: "Documentation",
    icon: <Books />,
    root: true,
    children: rest,
  };
  return { ...tree, children: [documentation, ...tree.children.filter(isTab)] };
}
