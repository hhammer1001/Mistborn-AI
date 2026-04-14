/**
 * Prompt system for interactive WebPlayer decisions.
 *
 * When a *In method needs user input, it throws PromptNeeded.
 * The session catches this, saves the prompt, and returns it to the frontend.
 * When the frontend responds, the session replays the action with the saved response.
 */

export interface PromptOption {
  index: number;
  [key: string]: unknown;
}

export class PromptNeeded extends Error {
  promptType: string;
  options: PromptOption[];
  context: string;

  constructor(promptType: string, options: PromptOption[], context = "") {
    super(`Prompt needed: ${promptType}`);
    this.name = "PromptNeeded";
    this.promptType = promptType;
    this.options = options;
    this.context = context;
  }

  toJSON() {
    return {
      type: this.promptType,
      options: this.options,
      context: this.context,
    };
  }
}
