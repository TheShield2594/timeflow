import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Dropdown, type DropdownOption } from "./Dropdown";

type Fruit = "apple" | "banana" | "cherry";

const OPTIONS: DropdownOption<Fruit>[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

function Harness({
  initial = "apple",
  onChange,
  placeholder,
}: {
  initial?: Fruit | "";
  onChange?: (v: Fruit) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState<Fruit | "">(initial);
  return (
    <Dropdown
      value={value as Fruit}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      ariaLabel="Fruit"
      placeholder={placeholder}
      options={OPTIONS}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: "Fruit" });

afterEach(cleanup);

describe("Dropdown", () => {
  it("shows the selected option's label", () => {
    render(<Harness initial="banana" />);
    expect(trigger().textContent).toContain("Banana");
  });

  it("shows the placeholder when the value matches no option", () => {
    render(<Harness initial="" placeholder="Pick one" />);
    expect(trigger().textContent).toContain("Pick one");
  });

  it("stays closed until opened, then exposes the options as a listbox", () => {
    render(<Harness />);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    // The current value is marked selected.
    const selected = screen.getByRole("option", { selected: true });
    expect(selected.textContent).toContain("Apple");
  });

  it("selecting an option reports it and closes the menu", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Cherry" }));

    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger().textContent).toContain("Cherry");
  });

  it("opens and moves the highlight with the keyboard, and commits on Enter", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // The trigger opens; focus then moves to the listbox, which owns navigation.
    // Opening lands on the current selection (Apple); ArrowDown moves to Banana.
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("banana");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks the active option for assistive tech via the listbox", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const listbox = screen.getByRole("listbox");
    // The active option is named by aria-activedescendant on the focusable
    // listbox — the model a native button cannot support.
    const activeId = listbox.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(screen.getByRole("option", { selected: true }).id).toBe(activeId);
  });

  it("closes on Escape without changing the value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when a click lands outside the menu", () => {
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>,
    );

    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
