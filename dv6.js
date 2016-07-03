class DV6 {
  constructor(dv6) {
    this._dv6 = dv6;
  }

  get dv6() { return this._dv6; }

  parse() {
    const parser = new DV6Parser(this.dv6);
    parser.parse();
    this._structure = parser.result;
    console.log(parser.errors);
    console.log(parser.warnings);
  }
}

class DV6Parser {
  constructor(dv6) {
    this._dv6 = dv6;
    this._errors = [];
    this._warnings = [];
  }

  get dv6() { return this._dv6; }

  get result() { return this._result; }

  get errors() { return this._errors; }

  get warnings() { return this._warnings; }

  get parsed() { return this.result || this.errors.length; }

  get success() { return this.result && !this.errors.length; }

  parse() {
    const dv6 = this.dv6;
    const lines = DV6Parser.dv6_to_lines(dv6);
    const structured_lines = DV6Parser.flat_to_structured_lines(lines);
    this._result = this.parse_toplevel(structured_lines);
  }

  static dv6_to_lines(dv6) {
    const line_re = /^(\t*)((?:\\\\|\\\r?\n?|[^\\])*)(\\)?$/;
    const raw_lines = dv6.split(/\r?\n/);
    const errors = [];
    const lines = [];
    let line_continued = false;
    for (let line_index = 0; line_index < raw_lines.length; line_index++) {
      const raw_line = raw_lines[line_index];
      const result = raw_line.match(line_re);
      const previous_line = lines[lines.length - 1];
      if (line_continued) {
        if (result[1].length !== previous_line.indent) {
          errors.push(`行${line_index + 1}: インデントが直前の継続行と不一致です`);
        }
        previous_line.line += result[2];
      } else {
        const line = new DV6Line({line_index, indent: result[1].length, content: result[2]});
        lines.push(line);
        if (previous_line && previous_line.indent < line.indent - 1) {
          errors.push(`行${line_index + 1}: インデントが直前の行から2レベル以上上がっています`);
        }
      }
      if (result[3]) {
        line_continued = true;
      } else {
        if (line_continued) previous_line.last_line_index = line_index;
        line_continued = false;
      }
    }
    if (errors.length) {
      throw new Error(erros.join("\n"));
    }
    return lines;
  }

  static flat_to_structured_lines(lines) {
    const structure_stack = [new DV6HeadLine()];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const next_line = lines[index + 1];
      const current_indent = structure_stack.length - 1;
      const current_structure = structure_stack[current_indent];
      if (next_line) {
        const indent_diff = next_line.indent - line.indent;
        if (indent_diff > 0) {
          const structure = new DV6HeadLine(line);
          current_structure.children.push(structure);
          structure_stack.push(structure);
        } else if (indent_diff < 0) {
          current_structure.children.push(line);
          structure_stack.splice(indent_diff, -indent_diff);
        } else {
          current_structure.children.push(line);
        }
      } else {
        current_structure.children.push(line);
      }
    }
    return structure_stack[0];
  }

  parse_toplevel(structure) {
    return structure.children.map((element) => {
      if (element.is_word) {
        if (element instanceof DV6HeadLine) {
          return this.parse_word(element);
        } else if (element instanceof DV6Line) {
          this.errors.push(element.error("単語の内容がありません"));
        }
      }
    }).filter((element) => element);
  }

  parse_word(structure) {
    const name = structure.content.match(/^#(.+?)$/)[1];
    const {properties, contents, extended} = this.parse_top_children(structure);
    const word = {name, properties, contents};
    return {word};
  }

  parse_top_children(structure) {
    const children = structure.children;
    let contents_begin_index = structure.children.findIndex((element) => !element.is_property);
    if (contents_begin_index === -1) contents_begin_index = children.length;
    let extended_begin_index = structure.children.findIndex((element) => element.is_extended);
    if (extended_begin_index === -1) extended_begin_index = children.length;
    const properties = this.parse_properties(children.slice(0, contents_begin_index));
    const contents = this.parse_contents(structure.children.slice(contents_begin_index, extended_begin_index));
    const extended = this.parse_extended(structure.children.slice(extended_begin_index));
    return {properties, contents, extended};
  }

  parse_children(structure) {
    const children = structure.children;
    let contents_begin_index = structure.children.findIndex((element) => !element.is_property);
    if (contents_begin_index === -1) contents_begin_index = children.length;
    const properties = this.parse_properties(children.slice(0, contents_begin_index));
    const contents = this.parse_contents(structure.children.slice(contents_begin_index));
    return {properties, contents};
  }

  parse_properties(elements) {
    const properties = [];
    for (const element of elements) {
      if (element instanceof DV6HeadLine) {
        this.errors.push(element.error('プロパティがインデントを持っています'));
      } else {
        const result = element.content.match(/^([A-Za-z]\w*):(.*)$/);
        if (result) {
          const name = result[1];
          const value = result[2];
          switch (name) {
            case 'yomi':
              properties.push({yomi: value});
              break;
            case 'qyomi':
              properties.push({qyomi: value});
              break;
            case 'spell':
              const spell_result = value.match(/^(\w+):(.+)$/);
              if (spell_result) {
                properties.push({spell: [{_attr: {lang: spell_result[1]}}, spell_result[2]]});
              } else {
                this.errors.push(element.error('spellプロパティの書式が正しくありません'));
              }
              break;
            case 'pron':
              const pron_result = value.match(/^(\w+):(.+)$/);
              if (pron_result) {
                properties.push({pron: [{_attr: {lang: pron_result[1]}}, pron_result[2]]});
              } else {
                this.errors.push(element.error('pronプロパティの書式が正しくありません'));
              }
              break;
            case 'pos':
              for (const pos of value.split(/,/)) {
                properties.push({pos});
              }
              break;
            case 'dir':
              if (value.startsWith('/') && !value.endsWith('/')) {
                properties.push({dir: value});
              } else {
                this.errors.push(element.error('dirプロパティは/で始まり/でない文字で終わるべきです'));
              }
              break;
            case 'flag':
              const known_flags = ['SPL', 'JOKE', 'MEDICAL', 'PHARM', 'MISS', 'DQN'];
              for (const flag of value.split(/,/)) {
                properties.push({flag});
                if (known_flags.includes(flag)) this.warnings.push(element.error(`未知のフラグ[${flag}]があります`));
              }
              break;
            case 'author':
              const author_info = value.split(/,/);
              if (author_info.length <= 4) {
                const [operation, dates_str, names_str, sources_str] = author_info;
                if (! ['A', 'R', 'I'].includes(operation)) {
                  this.errors.push(element.error('authorの処理内容はA,R,Iのみです'));
                  break;
                }
                const dates = dates_str.split(/;/);
                const names = names_str.split(/;/);
                const sources = sources_str ? sources_str.split(/;/) : [];
                const author = [{_attr: {operation}}];
                for (const date of dates) {
                  if (/^\d{4}\/\d{2}\/\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(date)) {
                    author.push({date});
                  } else {
                    this.errors.push(element.error(`日付書式が間違っています[${date}]`));
                    throw 1;
                    break;
                  }
                }
                for (const name of names) {
                  author.push({name});
                }
                for (const source of sources) {
                  author.push({source});
                }
                properties.push({author});
              } else {
                this.errors.push(element.error('authorプロパティの書式が正しくありません'));
              }
              break;
            case 'valid':
              if (/^(?:\d{4}\/\d{2}\/\d{2}|\d+ (?:day|week|month|year))$/.test(date)) {
                properties.push({valid: value});
              } else {
                this.errors.push(element.error(`日付書式が間違っています[${date}]`));
              }
              break;
            case 'expire':
              if (/^\d{4}\/\d{2}\/\d{2}$/.test(date)) {
                properties.push({expire: value});
              } else {
                this.errors.push(element.error(`日付書式が間違っています[${date}]`));
              }
              break;
            default:
              this.warnings.push(element.error('未知のプロパティ指定があります'));
              break;
          }
        } else {
          this.errors.push(element.error('プロパティの書式が正しくありません'));
        }
      }
    }
    return properties;
  }

  parse_contents(elements) {
    const contents = [];
    for (const element of elements) {
      const result = element.content.match(/^(\S+)\s(.*)$/);
      if (result) {
        const identifier = result[1];
        const line = result[2];
        // TODO
      } else {
        this.errors.push(element.error('内容は(記号)(空白)(内容)であるべきです'));
      }
    }
    return contents;
  }

  parse_inline(line) {
  }

  parse_extended(elements) {
  }
}

class DV6Line {
  constructor({line_index, last_line_index, indent, content}) {
    this.line_index = line_index;
    this.last_line_index = last_line_index;
    this.indent = indent;
    this.content = content;
  }
  
  get is_word() { return this.content.startsWith('#'); }
  get is_property() { return /^[A-Za-z0-9]+:/.test(this.content); }
  get is_extended() { return /^\/\//.test(this.content); }

  error(message) {
    const line_description = this.last_line_index ? `${this.line_index}-${this.last_line_index}` : this.line_index;
    return new Error(`行${line_description}: ${message}`);
  }
}

class DV6HeadLine extends DV6Line {
  constructor(line = {}, children = []) {
    super(line);
    this.children = children;
  }
}

module.exports = {DV6, DV6Parser};
