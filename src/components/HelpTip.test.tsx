import { useRef } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

afterEach(cleanup);

const TEXT = "Paces tracked work in blocks.";

/** The shape the focus chip uses (#84): a control the tip explains, with the
 *  "?" beside it. */
function Anchored() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <span>
      <button ref={anchor}>Focus off</button>
      <HelpTip label="What is focus mode?" text={TEXT} hoverAnchorRef={anchor} />
    </span>
  );
}

const tip = () => screen.queryByRole("tooltip");
const anchorBtn = () => screen.getByRole("button", { name: "Focus off" });
const questionBtn = () => screen.getByRole("button", { name: "What is focus mode?" });

describe("HelpTip", () => {
  it("opens on click and closes on a second click", () => {
    render(<HelpTip label="What is focus mode?" text={TEXT} />);
    expect(tip()).toBeNull();
    fireEvent.click(questionBtn());
    expect(tip()?.textContent).toContain(TEXT);
    fireEvent.click(questionBtn());
    expect(tip()).toBeNull();
  });

  it("reveals the tip when the anchored control is hovered", () => {
    render(<Anchored />);
    fireEvent.mouseEnter(anchorBtn());
    expect(tip()?.textContent).toContain(TEXT);
    fireEvent.mouseLeave(anchorBtn());
    expect(tip()).toBeNull();
  });

  it("keeps a clicked-open tip when the pointer leaves the anchor", () => {
    // Hover and click are separate reasons to be open; if they shared one flag,
    // brushing past the chip would dismiss a bubble the user pinned.
    render(<Anchored />);
    fireEvent.click(questionBtn());
    fireEvent.mouseEnter(anchorBtn());
    fireEvent.mouseLeave(anchorBtn());
    expect(tip()?.textContent).toContain(TEXT);
  });

  it("closes a hovered tip on Escape", () => {
    render(<Anchored />);
    fireEvent.mouseEnter(anchorBtn());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  it("does not close when the click lands on the anchored control", () => {
    // The anchor is a real control (the chip toggles focus mode); clicking it
    // shouldn't be read as "dismiss the explanation".
    render(<Anchored />);
    fireEvent.click(questionBtn());
    fireEvent.mouseDown(anchorBtn());
    expect(tip()?.textContent).toContain(TEXT);
  });
});
