import * as message from "../messages";
import * as validation from "../validations";
import { Namespace } from "#csharp/code-dom/namespace";
import { Project } from "../project";
import { State } from "../generator";
import { Dictionary } from "#remodeler/common";
import { Schema, JsonType } from "#remodeler/code-model";
import { ModelClass } from "./class";
import { StringFormat } from "#remodeler/known-format";
import { hasProperties } from "#common/text-manipulation";
import { TypeDeclaration } from "#csharp/code-dom/type-declaration";
import { getKnownFormatType } from "#remodeler/interpretations";

import { Wildcard, UntypedWildcard } from "../primitives/wildcard"
import { EnumClass } from "../support/enum";
import { ByteArray } from "../primitives/byte-array";
import { Boolean } from "../primitives/boolean";
import { Float } from "../primitives/floatingpoint";
import { ArrayOf } from "../primitives/array";
import { Integer } from "../primitives/integer";
import { Date } from "../primitives/date";
import { DateTime, DateTime1123 } from "../primitives/date-time";
import { Duration } from "../primitives/duration";
import { Uuid } from "../primitives/Uuid";
import { String } from "../primitives/string";
import { Char } from "../primitives/char";


export class ModelsNamespace extends Namespace {

  constructor(parent: Namespace, private schemas: Dictionary<Schema>, private state: State, objectInitializer?: Partial<ModelsNamespace>) {
    super("Models", parent);
    this.apply(objectInitializer);

    // special case... hook this up before we get anywhere.
    state.project.modelsNamespace = this;

    for (const schemaName in schemas) {
      const schema = this.schemas[schemaName];
      const state = this.state.path(schemaName);

      // verify that the model isn't in a bad state
      if (validation.objectWithFormat(schema, state)) {
        continue;
      }
      this.resolveTypeDeclaration(schema, state);
    }


  }

  private static INVALID = <any>null;

  public resolveTypeDeclaration(schema: Schema | undefined, state: State): TypeDeclaration {
    if (!schema) {
      throw new Error("SCHEMA MISSING?")
    }
    // have we done this object already?
    if (schema.details.privateData["type-declaration"]) {
      return schema.details.privateData["type-declaration"];
    }

    // determine if we need a new model class for the type or just a known type object
    switch (schema.type) {
      case JsonType.Object:
        // for certain, this should be a class of some sort.
        if (schema.additionalProperties && !hasProperties(schema.properties)) {
          if (schema.additionalProperties === true) {
            // the object is a wildcard for all key/object-value pairs 
            return this.createWildcardObject(schema, state);
          } else {
            // the object is a wildcard for all key/<specific-type>-value pairs
            const wcSchema = this.resolveTypeDeclaration(schema.additionalProperties, state.path("additionalProperties"));

            return this.createWildcardForSchema(schema, wcSchema, state);
          }
        }

        // otherwise, if it has additionalProperties
        // it's a regular object, that has a catch-all for unspecified properties.
        // (handled in ModelClass itself)

        const mc = schema.details.privateData["class-implementation"] || new ModelClass(this, schema, this.state);
        schema.details.privateData["type-declaration"] = schema.details.privateData["interface-implementation"];
        return schema.details.privateData["type-declaration"];

      case JsonType.String:
        switch (schema.format) {
          case StringFormat.Base64Url:
          case StringFormat.Byte:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            // member should be byte array
            // on wire format should be base64url 
            return this.createByteArray(schema, state);

          case StringFormat.Binary:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            // represent as a stream 
            // wire format is stream of bytes
            return this.createStream(schema, state);

          case StringFormat.Char:
            // a single character
            if (validation.hasXmsEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            return this.createChar(schema, state);

          case StringFormat.Date:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }

            return this.createDate(schema, state);
          case StringFormat.DateTime:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            return this.createDateTime(schema, state);

          case StringFormat.DateTimeRfc1123:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            return this.createDateTime1123(schema, state);

          case StringFormat.Duration:
            if (validation.schemaHasEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            return this.createDuration(schema, state);

          case StringFormat.Uuid:
            if (validation.hasXmsEnum(schema, state)) {
              return ModelsNamespace.INVALID;
            }
            return this.createUuid(schema, state);

          case StringFormat.Password:
          case StringFormat.None:
          case undefined:
          case null:
            if (schema.extensions["x-ms-enum"]) {
              // this value is an enum type instead of a plain string. 
              return this.createEnum(schema, state);
            }
            // just a regular old string.
            return this.createString(schema, state);

          default:
            state.error(`Schema with type:'${schema.type} and 'format:'${schema.format}' is not recognized.`, message.DoesNotSupportEnum);
        }
        break;

      case JsonType.Boolean:
        if (validation.hasXmsEnum(schema, state)) {
          return ModelsNamespace.INVALID;
        }
        return this.createBoolean(schema, state);

      case JsonType.Integer:
        if (validation.hasXmsEnum(schema, state)) {
          return ModelsNamespace.INVALID;
        }
        return this.createInteger(schema, state);

      case JsonType.Number:
        if (validation.hasXmsEnum(schema, state)) {
          return ModelsNamespace.INVALID;
        }
        return this.createFloatingpoint(schema, state);

      case JsonType.Array:
        if (validation.hasXmsEnum(schema, state)) {
          return ModelsNamespace.INVALID;
        }
        if (validation.arrayMissingItems(schema, state)) {
          return ModelsNamespace.INVALID;
        }
        const aSchema = this.resolveTypeDeclaration(<Schema>schema.items, state.path("items"));
        return this.createArray(schema, aSchema, state);

      case undefined:
        console.error(`schema 'undefined': ${schema.details.name} `);
        // "any" case
        break;

      default:
        this.state.error(`Schema is declared with invalid type '${schema.type}'`, message.UnknownJsonType);
        return ModelsNamespace.INVALID;
    }
    return ModelsNamespace.INVALID;
  }

  createWildcardObject(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new UntypedWildcard();
  }
  createWildcardForSchema(schema: Schema, typeDecl: TypeDeclaration, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Wildcard(typeDecl);
  }
  createByteArray(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new ByteArray();
  }
  createEnum(schema: Schema, state: State): TypeDeclaration {
    // throw new Error("Method not implemented.");
    // this schema has an x-ms-enum. Need to create the enum class definition 
    // first check for an enumclass with the same name
    const ec = state.project.supportNamespace.findClassByName(schema.extensions["x-ms-enum"].name);
    if (ec.length > 0) {
      return schema.details.privateData["type-declaration"] = ec[0];
    }

    return schema.details.privateData["type-declaration"] = new EnumClass(schema, state);
  }
  createStream(schema: Schema, state: State): TypeDeclaration {
    throw new Error("Method not implemented.");
  }
  createBoolean(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Boolean();
  }
  createFloatingpoint(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Float();
  }
  createArray(schema: Schema, typeDecl: TypeDeclaration, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new ArrayOf(typeDecl);
  }
  createInteger(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Integer();
  }
  createDate(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Date();
  }
  createDateTime(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new DateTime();
  }
  createDateTime1123(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new DateTime1123();
  }
  createDuration(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Duration();
  }
  createUuid(schema: Schema, state: State): TypeDeclaration {
    return schema.details.privateData["type-declaration"] = new Uuid();
  }
  createString(schema: Schema, state: State): TypeDeclaration {
    // create a validated string typedeclaration.
    return schema.details.privateData["type-declaration"] = new String(schema.minLength, schema.maxLength, schema.pattern, schema.enum.length > 0 ? schema.enum : undefined);
  }
  createChar(schema: Schema, state: State): TypeDeclaration {
    // create a validated string typedeclaration.
    return schema.details.privateData["type-declaration"] = new Char(schema.enum.length > 0 ? schema.enum : undefined);
  }

}

