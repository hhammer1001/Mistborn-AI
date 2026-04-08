"""
Prompt system for interactive WebPlayer decisions.

When a *In method needs user input, it raises PromptNeeded.
The session catches this, saves the prompt, and returns it to the frontend.
When the frontend responds, the session replays the action with the saved response.
"""


class PromptNeeded(Exception):
    """Raised when the WebPlayer needs user input mid-action."""

    def __init__(self, prompt_type: str, options: list, context: str = ""):
        self.prompt_type = prompt_type
        self.options = options
        self.context = context
        super().__init__(f"Prompt needed: {prompt_type}")

    def to_dict(self):
        return {
            "type": self.prompt_type,
            "options": self.options,
            "context": self.context,
        }
