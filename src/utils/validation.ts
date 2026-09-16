const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (color?: string) => !color || HEX_COLOR_REGEX.test(color);
