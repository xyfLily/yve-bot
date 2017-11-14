import { Answer, EventName, IContext, IFlow, IListener, IRule, IYveBotOptions } from '../types';
import { Actions } from './actions';
import { Controller } from './controller';
import * as Exceptions from './exceptions';
import { Executors } from './executors';
import { Listeners } from './listeners';
import { sanitizeBotRules, sanitizeListener, sanitizeRule } from './sanitizers';
import { IStoreData, Store } from './store';
import { Types } from './types';
import { Validators } from './validators';

export default class YveBot {
  public static types: Types;
  public static actions: Actions;
  public static listeners: Listeners;
  public static executors: Executors;
  public static validators: Validators;
  public static exceptions: any;

  public options: IYveBotOptions;
  public rules: IRule[];
  public controller: Controller;
  public store: Store;
  public sessionId: string;

  private handlers: { [handler: string]: Array<() => any> };

  constructor(rules: Array<IRule|IFlow>, customOpts?: IYveBotOptions) {
    const DEFAULT_OPTS: IYveBotOptions = {
      enableWaitForSleep: true,
      timePerChar: 40,
    };

    this.sessionId = 'session';
    this.options = Object.assign({}, DEFAULT_OPTS, customOpts);
    this.rules = sanitizeBotRules(rules);
    this.handlers = {};

    this.store = new Store(this);
    this.controller = new Controller(this);

    if (this.options.context) {
      this.store.set('context', this.options.context);
    }

    this.on('error', (err) => { throw err; });
  }

  public get context(): IContext {
    return this.store.get('context');
  }

  public get types() { return YveBot.types; }
  public get actions() { return YveBot.actions; }
  public get listeners() { return YveBot.listeners; }
  public get executors() { return YveBot.executors; }
  public get validators() { return YveBot.validators; }

  public on(evt: EventName, fn: (...args: any[]) => any): this {
    const isUniqueType = ['error'].indexOf(evt) >= 0;
    if (!isUniqueType && evt in this.handlers) {
      this.handlers[evt].push(fn);
    } else {
      this.handlers[evt] = [fn];
    }
    return this;
  }

  public listen(listeners: IListener[]): this {
    this.on('listen', (message, rule) => {
      listeners.every((item) => {
        const listener = sanitizeListener(item);
        const ignorePassive = !listener.passive && ['Passive', 'PassiveLoop'].indexOf(rule.type) < 0;
        const ignoreRule = !rule.passive;
        if (!listener.next || ignorePassive || ignoreRule) {
          return true;
        }
        const [key] = Object.keys(listener)
          .filter((k) => k !== 'next' && k in this.listeners);
        if (key) {
          const result = this.listeners[key](listener[key], message);
          if (result) {
            this.store.set('waitingForAnswer', false);
            this.controller.jumpByName(listener.next);
            return false;
          }
        }
        return true;
      });
    });
    return this;
  }

  public start(): this {
    this.dispatch('start');
    this.controller.run().catch(this.tryCatch.bind(this));
    return this;
  }

  public end(): this {
    this.dispatch('end', this.store.output());
    return this;
  }

  public talk(message: string, opts?: object): this {
    const rule = Object.assign({}, this.options.rule, opts || {});
    this.controller.sendMessage(message, rule);
    return this;
  }

  public hear(answer: Answer | Answer[]): this {
    this.controller.receiveMessage(answer).catch(this.tryCatch.bind(this));
    return this;
  }

  public dispatch(name: EventName, ...args) {
    if (name in this.handlers) {
      this.handlers[name].forEach((fn) => fn(...args, this.sessionId));
    }
  }

  public session(
    id: string,
    opts: { context?: IContext, store?: IStoreData, rules?: IRule[] } = {},
  ): this {
    this.sessionId = id;

    if (opts.rules) {
      this.rules = opts.rules.map(sanitizeRule);
      this.controller.reindex();
    }

    if (opts.store) {
      this.store.replace(opts.store);
    } else {
      this.store.reset();
    }

    if (opts.context) {
      this.store.set('context', opts.context);
    }

    return this;
  }

  public addRules(rules: Array<IRule|IFlow>) {
    this.rules = this.rules.concat(
      rules.map(sanitizeRule),
    );
    this.controller.reindex();
  }

  private tryCatch(err: Error) {
    this.dispatch('error', err);
    this.end();
  }
}

YveBot.types = new Types();
YveBot.actions = new Actions();
YveBot.listeners = new Listeners();
YveBot.executors = new Executors();
YveBot.validators = new Validators();
YveBot.exceptions = Exceptions;
