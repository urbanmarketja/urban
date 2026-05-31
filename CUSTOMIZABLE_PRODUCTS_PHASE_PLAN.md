# Customizable Products Phase Plan

This plan explains how to add customizable products to Urban Market JA in phases. The goal is to let vendors sell items such as shirts, cups, bottles, keychains, necklaces, stickers, and similar goods where customers can enter text, choose options, upload images, and preview the result before ordering.

The system should stay flexible. Instead of building one separate system for shirts, another for cups, and another for keychains, the site should have one customizable product builder with product-type presets.

## Phase 1 - Product Customization Data Model

Status: Completed locally. The schema now includes customization templates, surfaces, fields, options, placement rules, cart customization capture, and order customization capture. Do not apply the online database script until the full phased build is ready.

Add the database structure needed to describe customizable products without hard-coding each product type.

Required records:

- Product customization template connected to a product.
- Product type, such as T-shirt, cup, bottle, keychain, necklace, sticker, or other.
- Customization surfaces, such as front, back, wrap area, label area, or face.
- Customization fields, such as name, number, message, color, dropdown, checkbox, or image upload.
- Field options for dropdowns, fonts, colors, sizes, finishes, and add-ons.
- Saved placement rules for each field, including x position, y position, width, height, rotation, font size, and color.
- Customer customization values saved with cart and order items.
- Final preview snapshot or reference saved with the order.

Important rule:

- Store field placement as percentages, not fixed pixels, so previews work on desktop and mobile.

## Phase 2 - Backend APIs

Status: Completed locally. Backend routes now support vendor customization setup, public validation, customized cart capture, order customization capture, and admin review controls. Do not push or apply database changes until all phases are complete.

Create backend endpoints for vendors and customers.

Vendor APIs:

- Create or update a customization template for a product.
- Add, edit, reorder, enable, disable, or delete customization fields.
- Add surfaces for products with more than one design area.
- Save field placement positions.
- Upload preview/base images for each product surface.
- Load a vendor preview of the full customization setup.

Customer APIs:

- Load a public product with its customization template.
- Validate customer customization choices.
- Add customized product to cart.
- Save customization values and preview reference with the order.

Admin APIs:

- View customizable product templates.
- Disable abusive or invalid customization templates.
- Review uploaded customer images if needed.

## Phase 3 - Vendor Product Builder

Status: Completed locally. Vendors can now mark a product as customizable, choose a preset, upload a base image, add text/number/color/dropdown/checkbox fields, drag fields on the preview, fine tune placement, and save a customization template for new or existing products. Do not push or apply database changes until all phases are complete.

Add a vendor workflow inside the vendor dashboard.

Vendor flow:

1. Vendor creates or edits a product.
2. Vendor chooses `Standard product` or `Customizable product`.
3. Vendor selects a preset, such as T-shirt, cup, bottle, keychain, jewelry, sticker, or other.
4. Vendor uploads a blank/base product image.
5. Vendor adds customization fields.
6. Vendor drags fields onto the product preview.
7. Vendor previews how a customer will see it.
8. Vendor saves and publishes the product.

First supported field types:

- Text input.
- Number input.
- Color picker.
- Dropdown.
- Checkbox.

Later field type:

- Customer image upload.

## Phase 4 - Layout And Preview Editor

Status: Completed locally. The vendor editor now has a stronger one-surface visual layout tool with draggable fields, direct resize handles, editable selected-field settings, live sample values, percentage-based sizing/positioning, text color, rotation, and left/center/right alignment controls. Do not push or apply database changes until all phases are complete.

Build the visual editor that lets vendors place fields on the product.

Editor requirements:

- Show the base product image.
- Allow drag-and-drop positioning.
- Allow resizing text/image areas.
- Allow field alignment controls.
- Save position as percentages.
- Show a live preview sample value.
- Support at least one surface first, then multiple surfaces later.

Suggested first version:

- One image surface.
- Drag text/number/color output onto the surface.
- Save x/y position, width, font size, and text color.

## Phase 5 - Customer Product Page

Status: Completed locally. Customer product detail pages now show the saved customization template, render the vendor's preview layout, collect customer text/number/color/dropdown/checkbox values, require preview confirmation, validate choices through the backend, and add the customized item to the cart with a customization signature. Marketplace, home, and store listing cards send customizable products to the product page instead of adding a plain item directly. Do not push or apply database changes until all phases are complete.

Update the product detail page so customers can customize supported products.

Customer experience:

- Product page shows product images, description, store link, and price.
- If product is customizable, show a customization form.
- Customer enters values, such as name, number, message, color, or selected option.
- Preview updates using the same saved vendor layout.
- Customer confirms the preview before adding to cart.

Important:

- The customer should see exactly what the vendor will receive.
- The preview does not need to be perfect print-production quality at first, but it must be clear enough for ordering.

## Phase 6 - Cart, Checkout, And Order Capture

Status: Completed locally. Customized cart items now carry summary text, preview references, edit links, add-on-aware pricing, checkout preservation, invoice details, order detail display, and vendor order line-item visibility. Vendors can also mark an individual customized order item fulfilled. Do not push or apply database changes until all phases are complete.

Make customized items carry their selected options through the full buying flow.

Cart requirements:

- Show product name and store.
- Show customization summary.
- Show preview thumbnail if available.
- Allow customer to edit customization before checkout.

Checkout requirements:

- Preserve customization values.
- Include customization summary in invoice.
- Include preview reference in order details.

Vendor order dashboard requirements:

- Vendor sees each customized item.
- Vendor sees customer-entered values.
- Vendor sees preview image or layout preview.
- Vendor can mark customized item as fulfilled.

## Phase 7 - Price Add-Ons

Status: Completed locally. Vendors can now enter add-on prices for customization fields and dropdown choices, customers see live customization add-ons and the updated unit total before adding to cart, and cart, checkout, invoices, order details, and vendor order lines show add-on totals. Backend validation now calculates add-ons from saved field/option pricing and does not charge optional checkbox add-ons unless selected. Do not push or apply database changes until all phases are complete.

Add optional price adjustments for customization choices.

Examples:

- Extra text line: +JMD 300.
- Back-of-shirt print: +JMD 700.
- Premium color: +JMD 500.
- Custom image upload: +JMD 1,000.
- Gift packaging: +JMD 400.

Requirements:

- Add-ons must update product price before cart.
- Cart and invoice must show base price plus customization add-ons.
- Vendor dashboard must clearly show what the customer paid for.

## Phase 8 - Multiple Surfaces And Presets

Status: Completed locally. The customization builder now supports multiple product surfaces, preset surface layouts, recommended dimensions, and common starting fields for T-shirts, cups, bottles, keychains, necklaces, stickers, and generic custom products. Customers can switch between saved surfaces on the product page, and cart/order preview capture now includes every configured surface. Backend template saves also clean up removed surfaces, fields, options, and placements so old layout pieces do not linger. Do not push or apply database changes until all phases are complete.

Expand the system beyond one simple preview surface.

Presets to add:

- T-shirt front and back.
- Cup wrap area.
- Water bottle front label.
- Keychain face.
- Necklace pendant face.
- Sticker or decal.
- Generic custom product.

Each preset should provide:

- Suggested surfaces.
- Default field placement.
- Recommended image dimensions.
- Common fields vendors can edit or remove.

## Phase 9 - Customer Image Uploads

Status: Completed locally. Customer image customization fields now accept JPG, PNG, WEBP, HEIC, and HEIF uploads up to 8 MB, show a live customer preview, save uploaded image files under customization media, carry sanitized image metadata through cart/order customizations, and expose uploaded image references for vendor/admin review. Do not push or apply database changes until all phases are complete.

Allow customers to upload images for custom products.

Examples:

- Logo on shirt.
- Photo on cup.
- Image on keychain.
- Artwork on sticker.

Requirements:

- File type validation.
- File size limits.
- Image preview.
- Optional admin or vendor review.
- Store uploaded image with cart/order customization.

## Phase 10 - Production Hardening

Status: Completed locally. The custom product flow now has mobile-friendly editor layout rules, client-side image optimization before upload, clearer print-area warnings, stronger customer-side and backend validation, safer customer image URL handling, checkout approval for customized carts, customization audit logging for order capture/fulfillment/receipt/disputes, and vendor production sheet export. All customization phases are now complete locally; do not push until you confirm.

Prepare the customization system for real use.

Needed improvements:

- Mobile-friendly editor for vendors.
- Better image compression.
- Clear print-area warnings.
- Validation for text length and required fields.
- Safe handling of uploaded customer images.
- Audit trail for customization changes after an order is placed.
- Customer approval checkbox before checkout.
- Vendor-ready order export or printable production sheet.

## Recommended Build Order

Start small and useful:

1. Add database tables.
2. Add backend APIs.
3. Add one-surface vendor builder.
4. Add text, number, color, dropdown, and checkbox fields.
5. Add customer preview on product page.
6. Save customization to cart and order.
7. Add vendor order view.
8. Add price add-ons.
9. Add multiple surfaces and presets.
10. Add customer image uploads.

## First Version Scope

The first version should support:

- One base product image.
- Text field.
- Number field.
- Color picker.
- Dropdown field.
- Checkbox field.
- Vendor drag placement.
- Customer live preview.
- Cart and order customization capture.

This gives Urban Market JA a working customizable product system without trying to cover every possible custom product immediately.
