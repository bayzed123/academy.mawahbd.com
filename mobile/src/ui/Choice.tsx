import { useMemo, useState } from "react";
import { FlatList, Modal, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrefs } from "../prefs";
import { FONT, RADIUS } from "../theme";
import { Icon } from "./Icon";
import { Press } from "./Press";
import { Txt } from "./Txt";

export interface ChoiceOption<T> {
  value: T;
  label: string;
  /** options with the same group are listed under it, in the order given */
  group?: string;
}

interface Props<T> {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** shown when nothing is chosen yet */
  placeholder?: string;
  /** a box to search a long list (the ingredients) */
  searchable?: boolean;
  box?: StyleProp<ViewStyle>;
}

type Row<T> = { kind: "group"; title: string } | { kind: "option"; option: ChoiceOption<T> };

/**
 * Android has no drop-down list like a website's: the field shows what is chosen, and a tap opens the choices in a sheet from the bottom
 * (searchable when the list is long). The phone's back button and a tap outside close it without changing anything.
 */
export function Choice<T extends string | number>({ label, value, options, onChange, placeholder, searchable, box }: Props<T>) {
  const { c, t } = usePrefs();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase();
    const shown = words ? options.filter((o) => o.label.toLowerCase().includes(words)) : options;
    const out: Row<T>[] = [];
    let group: string | undefined;
    for (const option of shown) {
      if (option.group !== undefined && option.group !== group) out.push({ kind: "group", title: option.group });
      group = option.group;
      out.push({ kind: "option", option });
    }
    return out;
  }, [options, q]);
  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <View style={[{ gap: 6 }, box]}>
      <Txt v="label" color={c.text2}>
        {label}
      </Txt>
      <Press
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder ?? ""}`}
        style={{ minHeight: 50, borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.line2, backgroundColor: c.surface, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Txt numberOfLines={2} color={current ? c.text : c.text3} style={{ flex: 1 }}>
          {current?.label ?? placeholder ?? ""}
        </Txt>
        <Icon name="chevronDown" size={18} color={c.text3} />
      </Press>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Press onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} scale={1} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
          </Press>
          {/* a list one searches is a tall sheet: its search box then sits near the top, above the keyboard (inside a pop-up Android does not
              say where the keyboard is, so the sheet cannot move for it), and what matches shows right below the box */}
          <View
            style={[
              searchable ? { height: "88%" } : { maxHeight: "82%" },
              { backgroundColor: c.surface, borderTopLeftRadius: RADIUS.l, borderTopRightRadius: RADIUS.l, borderTopWidth: 1, borderColor: c.line, paddingBottom: insets.bottom + 8 },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
              <Txt v="heading" style={{ flex: 1 }} numberOfLines={2}>
                {label}
              </Txt>
              <Press onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
                <Icon name="close" size={20} color={c.text} />
              </Press>
            </View>
            {searchable ? (
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={t("fc.search")}
                placeholderTextColor={c.text3}
                accessibilityLabel={t("fc.search")}
                autoCorrect={false}
                style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: c.raised, borderRadius: RADIUS.m, minHeight: 46, paddingHorizontal: 14, color: c.text, fontFamily: FONT.regular, fontSize: 16 }}
              />
            ) : null}
            <FlatList
              data={rows}
              keyExtractor={(r, i) => (r.kind === "group" ? `g${i}` : `o${String(r.option.value)}`)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) =>
                item.kind === "group" ? (
                  <Txt v="tiny" color={c.text3} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {item.title}
                  </Txt>
                ) : (
                  <Press
                    onPress={() => {
                      onChange(item.option.value);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.option.label}
                    accessibilityState={{ selected: item.option.value === value }}
                    scale={0.99}
                    style={{ minHeight: 50, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: item.option.value === value ? c.accentSoft : "transparent" }}
                  >
                    <Txt style={{ flex: 1 }}>{item.option.label}</Txt>
                    {item.option.value === value ? <Icon name="check" size={20} color={c.accent} /> : null}
                  </Press>
                )
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
