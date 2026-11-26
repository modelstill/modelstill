import argparse

from modelstill import cli


def commands() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for group_action in cli._parser()._actions:
        if not isinstance(group_action, argparse._SubParsersAction):
            continue
        for group, parser in group_action.choices.items():
            for action in parser._actions:
                if isinstance(action, argparse._SubParsersAction):
                    found.update((group, name) for name in action.choices)
    return found


def groups() -> set[str]:
    for action in cli._parser()._actions:
        if isinstance(action, argparse._SubParsersAction):
            return set(action.choices)
    return set()
