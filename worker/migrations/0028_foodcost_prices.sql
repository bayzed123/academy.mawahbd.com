-- FoodCost: the Dhaka prices of the 45 starter ingredients (0027 added them without prices, so every recipe said "no price yet" and no
-- cost could be worked out). Each is a shared default ("Dhaka average", workspace_id NULL): it counts for everyone until they set their
-- own price, and the owner changes it in Admin → FoodCost. Retail prices checked on 7 November 2026: the staples from the latest Dhaka
-- market report (The Business Standard, late October 2026), the rest from Chaldal's listings; the source of each is in its supplier
-- field. Two need a weight to turn pieces into grams, so the banana gets the weight of one (100 g, a small USDA banana; a sagor kola) and
-- lemon juice is priced by the millilitre from four lemons of about 20 ml each. An ingredient that already has a default price (the
-- owner's own) is left as it is, so this file never overwrites one.

UPDATE fc_ingredients SET g_per_piece = 100 WHERE workspace_id IS NULL AND name_en = 'Banana (ripe)' AND g_per_piece IS NULL;

INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 2, 'kg', 17000, 'Dhaka market report (TBS, late Oct 2026): packaged maida, 2 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'All-purpose flour (maida)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 2, 'kg', 14000, 'Dhaka market report (TBS, late Oct 2026): packaged atta, 2 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Whole wheat flour (atta)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 6900, 'Chaldal: corn flour (loose), 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cornflour (corn starch)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 4800, 'Chaldal: Fresh suji, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Semolina (suji)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 7000, 'Chaldal: rice flour (chaler gura), 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Rice flour' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 124900, 'Chaldal: rolled oats, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Rolled oats' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 11000, 'Dhaka market report (TBS, late Oct 2026): sugar, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Sugar' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 250, 'g', 10000, 'Chaldal: Anchor icing sugar, 250 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Icing sugar' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 18500, 'Chaldal: Fargo brown sugar, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Brown sugar' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 43000, 'Chaldal: Saffola honey, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Honey' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 12, 'piece', 15000, 'Dhaka market report (TBS, late Oct 2026): eggs, a dozen', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Egg' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 12, 'piece', 15000, 'Dhaka market report (TBS, late Oct 2026): a dozen eggs (one egg''s white)', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Egg white' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 12, 'piece', 15000, 'Dhaka market report (TBS, late Oct 2026): a dozen eggs (one egg''s yolk)', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Egg yolk' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 80000, 'Chaldal: Amul unsalted butter, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Unsalted butter' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 200, 'g', 27000, 'Chaldal: Aarong / Milk Vita butter, 200 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Salted butter' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'l', 10000, 'Chaldal: pasteurized full cream milk, 1 L', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Milk (full cream)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 94500, 'Chaldal: Marks full cream milk powder, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Milk powder (full cream)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 397, 'g', 10500, 'Chaldal: Danish condensed milk, 397 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Sweetened condensed milk' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 125000, 'Chaldal: Grand''Or UHT whipping cream, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Whipping cream (dairy)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 250, 'g', 75000, 'Chaldal: Philadelphia cream cheese, 250 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cream cheese' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 88000, 'Chaldal: Quality mozzarella, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Mozzarella cheese' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 200, 'g', 46000, 'Chaldal: Grand''Or cheddar, 200 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cheddar cheese' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 11000, 'Chaldal: Aarong sour yogurt, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Plain yogurt (dahi)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'l', 20500, 'Dhaka market report (TBS, late Oct 2026): bottled soybean oil, 1 L', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Soybean oil' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 140000, 'Dhaka market report (TBS, late Oct 2026): ghee, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Ghee' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 75000, 'Chaldal: Aseel vegetable ghee, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Vegetable shortening (dalda)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 150, 'g', 9000, 'Chaldal: Saad baking powder, 150 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Baking powder' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 2500, 'Chaldal: baking soda, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Baking soda' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 10000, 'Chaldal: Angel instant dry yeast, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Dry yeast' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 1, 'kg', 4200, 'Chaldal: Molla / ACI salt, 1 kg', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Salt' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 50, 'g', 6500, 'Chaldal: Anchor gelatine, 50 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Gelatin powder' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 28, 'ml', 14000, 'Chaldal: Foster Clark''s vanilla essence, 28 ml', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Vanilla extract' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 125, 'g', 17900, 'Chaldal: Cadbury cocoa powder, 125 g pack', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cocoa powder' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 41500, 'Chaldal: Lindt 70% dark chocolate, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Dark chocolate (70–85%)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 50, 'g', 8000, 'Chaldal: Cadbury Dairy Milk, 50 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Milk chocolate' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 62500, 'Chaldal: Khaas Food almonds, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Almonds' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 73000, 'Chaldal: cashew nuts, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cashew nuts' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 17900, 'Chaldal: walnuts, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Walnuts' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 200, 'g', 8000, 'Chaldal: peeled peanuts, 200 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Peanuts' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 9900, 'Chaldal: raisins, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Raisins' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 500, 'g', 45900, 'Chaldal: Kalmi dates, 500 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Dates' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 6000, 'Chaldal: Ekata coconut powder, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Desiccated coconut' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 12, 'piece', 12900, 'Chaldal: sagor bananas, a dozen', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Banana (ripe)' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 80, 'ml', 4900, 'Chaldal: 4 kagozi lemons (about 20 ml juice each)', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Lemon juice' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on) SELECT i.id, NULL, 100, 'g', 11000, 'Chaldal: Farmer''s Gold cinnamon powder, 100 g', '2026-11-07'
  FROM fc_ingredients i WHERE i.workspace_id IS NULL AND i.name_en = 'Cinnamon powder' AND NOT EXISTS (SELECT 1 FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL);
