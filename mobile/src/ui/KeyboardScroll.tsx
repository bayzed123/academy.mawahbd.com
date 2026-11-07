import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type Ref } from "react";
import { Keyboard, Platform, ScrollView, TextInput, View, type KeyboardEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { keyboardOverlap, revealOffset } from "../lib/keyboard";

/*
 * A scrolling screen that keeps the box one types in above the keyboard. The app draws edge to edge, and then Android no longer shrinks the
 * screen when the keyboard opens (React Native's own KeyboardAvoidingView only does it on iOS unless told to): so this view measures how
 * much of it the keyboard covers, makes that much room at its bottom, and scrolls the box being typed in, with its label and its message,
 * into clear view above the keyboard — when the keyboard opens, and each time another box gets the focus while it is open (the "Next" key).
 * On an older Android that still shrinks the window itself, the keyboard covers none of the view, so it makes no room twice.
 */

type ScrollRef = ComponentRef<typeof ScrollView>;
interface FieldHooks {
  focused: () => void;
  blurred: () => void;
}
const FieldContext = createContext<FieldHooks | null>(null);

/** For a text box inside a KeyboardScroll: tell it when the box gets and loses the focus (Field and KeyboardTextInput do). */
export function useKeyboardField(): FieldHooks | null {
  return useContext(FieldContext);
}

/** Waits for the keyboard to settle and the room to be made, then scrolls (keyboardDidShow comes as Android's keyboard finishes opening). */
const SETTLE_MS = 60;

type Props = Omit<ComponentProps<typeof ScrollView>, "ref"> & { ref?: Ref<ScrollRef> };

export function KeyboardScroll({ ref, style, onScroll, children, ...rest }: Props) {
  const outer = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ScrollRef | null>(null);
  const offset = useRef(0);
  /** the keyboard's top edge on the screen while it is open */
  const keyboardTop = useRef<number | null>(null);
  /** one of this view's own boxes has the focus (another screen's box is not this view's to scroll to) */
  const owns = useRef(false);
  const [room, setRoom] = useState(0);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    if (top === null) return setRoom(0);
    outer.current?.measureInWindow((_x, y, _w, h) => setRoom(keyboardOverlap({ top: y, height: h }, top)));
  }, []);

  const reveal = useCallback(() => {
    setTimeout(() => {
      const top = keyboardTop.current;
      const field = TextInput.State.currentlyFocusedInput();
      if (top === null || !owns.current || !field || !outer.current) return;
      outer.current.measureInWindow((_x, y, _w, h) => {
        if (!(h > 0)) return;
        field.measureInWindow((_fx, fy, _fw, fh) => {
          const to = revealOffset({ offset: offset.current, viewTop: y, viewBottom: Math.min(y + h, top), fieldTop: fy, fieldBottom: fy + fh });
          if (to !== null) scroll.current?.scrollTo({ y: to, animated: true });
        });
      });
    }, SETTLE_MS);
  }, []);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e: KeyboardEvent) => {
        keyboardTop.current = e.endCoordinates.screenY;
        measure();
        reveal();
      }),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => {
        keyboardTop.current = null;
        setRoom(0);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [measure, reveal]);

  // once the room is made the view is shorter: bring the box into view in it
  useEffect(() => {
    if (room > 0) reveal();
  }, [room, reveal]);

  const hooks = useMemo<FieldHooks>(
    () => ({
      focused: () => {
        owns.current = true;
        reveal();
      },
      blurred: () => {
        owns.current = false;
      },
    }),
    [reveal],
  );

  const setRefs = useCallback(
    (node: ScrollRef | null) => {
      scroll.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <FieldContext.Provider value={hooks}>
      <View
        ref={outer}
        style={{ flex: 1, paddingBottom: room }}
        onLayout={() => {
          // the window itself changed size (an older Android, or the phone turned): how much is covered may have changed
          if (keyboardTop.current !== null) measure();
        }}
      >
        <ScrollView
          ref={setRefs}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          scrollEventThrottle={16}
          {...rest}
          style={[{ flex: 1 }, style]}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            offset.current = e.nativeEvent.contentOffset.y;
            onScroll?.(e);
          }}
        >
          {children}
        </ScrollView>
      </View>
    </FieldContext.Provider>
  );
}

/** A plain TextInput that a KeyboardScroll keeps above the keyboard (screens that draw their own boxes, like the login). */
export function KeyboardTextInput({ onFocus, onBlur, ...rest }: ComponentProps<typeof TextInput>) {
  const kb = useKeyboardField();
  return (
    <TextInput
      {...rest}
      onFocus={(e) => {
        kb?.focused();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        kb?.blurred();
        onBlur?.(e);
      }}
    />
  );
}
