import type { ComponentProps } from "react";
import { TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { usePrefs } from "../prefs";
import { FONT, RADIUS } from "../theme";
import { Txt } from "./Txt";

type Props = ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  hint?: string;
  /** where the field sits in its row (flex: 1 shares a row evenly) */
  box?: StyleProp<ViewStyle>;
};

/** A box to type in with its label above and its error (or a hint) below — the label is also what a screen reader says. */
export function Field({ label, error, hint, box, style, ...rest }: Props) {
  const { c } = usePrefs();
  return (
    <View style={[{ gap: 6 }, box]}>
      <Txt v="label" color={c.text2}>
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={c.text3}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        {...rest}
        style={[
          {
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: error ? c.bad : c.line2,
            borderRadius: RADIUS.m,
            minHeight: 50,
            paddingHorizontal: 14,
            color: c.text,
            fontFamily: FONT.regular,
            fontSize: 16,
          },
          rest.multiline ? { minHeight: 96, paddingTop: 12, textAlignVertical: "top" } : null,
          style,
        ]}
      />
      {error ? (
        <Txt v="small" color={c.bad} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : hint ? (
        <Txt v="tiny" color={c.text3}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}
