// Copyright (c) Microsoft Open Technologies, Inc. All rights reserved. See License.txt in the project root for license information.

(function (root, factory) {
    var freeExports = typeof exports == 'object' && exports,
        freeModule = typeof module == 'object' && module && module.exports == freeExports && module,
        freeGlobal = typeof global == 'object' && global;
    if (freeGlobal.global === freeGlobal) {
        window = freeGlobal;
    }

    // Because of build optimizers
    if (typeof define === 'function' && define.amd) {
        define(['rx', 'exports'], function (Rx, exports) {
            root.Rx = factory(root, exports, Rx);
            return root.Rx;
        });
    } else if (typeof module === 'object' && module && module.exports === freeExports) {
        module.exports = factory(root, module.exports, require('./rx'));
    } else {
        root.Rx = factory(root, {}, root.Rx);
    }
}(this, function (global, exp, Rx, undefined) {
    
	// Aliases
	var Scheduler = Rx.Scheduler,
		PriorityQueue = Rx.Internals.PriorityQueue,
		ScheduledItem = Rx.Internals.ScheduledItem,
		SchedulePeriodicRecursive  = Rx.Internals.SchedulePeriodicRecursive,
		disposableEmpty = Rx.Disposable.empty,
		inherits = Rx.Internals.inherits;

	function defaultSubComparer(x, y) { return x - y; }

    /** Provides a set of extension methods for virtual time scheduling. */
    Rx.VirtualTimeScheduler = (function (_super) {

        function localNow() {
            return this.toDateTimeOffset(this.clock);
        }

        function scheduleNow(state, action) {
            return this.scheduleAbsoluteWithState(state, this.clock, action);
        }

        function scheduleRelative(state, dueTime, action) {
            return this.scheduleRelativeWithState(state, this.toRelative(dueTime), action);
        }

        function scheduleAbsolute(state, dueTime, action) {
            return this.scheduleRelativeWithState(state, this.toRelative(dueTime - this.now()), action);
        }

        function invokeAction(scheduler, action) {
            action();
            return disposableEmpty;
        }

        inherits(VirtualTimeScheduler, _super);

        /**
         * Creates a new virtual time scheduler with the specified initial clock value and absolute time comparer.
         *
         * @constructor
         * @param {Number} initialClock Initial value for the clock.
         * @param {Function} comparer Comparer to determine causality of events based on absolute time.
         */
        function VirtualTimeScheduler(initialClock, comparer) {
            this.clock = initialClock;
            this.comparer = comparer;
            this.isEnabled = false;
            this.queue = new PriorityQueue(1024);
            _super.call(this, localNow, scheduleNow, scheduleRelative, scheduleAbsolute);
        }

        var VirtualTimeSchedulerPrototype = VirtualTimeScheduler.prototype;

        /**
         * Schedules a periodic piece of work by dynamically discovering the scheduler's capabilities. The periodic task will be emulated using recursive scheduling.
         * 
         * @memberOf VirtualTimeScheduler#         
         * @param {Mixed} state Initial state passed to the action upon the first iteration.
         * @param {Number} period Period for running the work periodically.
         * @param {Function} action Action to be executed, potentially updating the state.
         * @returns {Disposable} The disposable object used to cancel the scheduled recurring action (best effort).
         */      
        VirtualTimeSchedulerPrototype.schedulePeriodicWithState = function (state, period, action) {
            var s = new SchedulePeriodicRecursive(this, state, period, action);
            return s.start();
        };

        /**
         * Schedules an action to be executed after dueTime.
         * 
         * @memberOf VirtualTimeScheduler#
         * @param {Mixed} state State passed to the action to be executed.
         * @param {Number} dueTime Relative time after which to execute the action.
         * @param {Function} action Action to be executed.
         * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
         */            
        VirtualTimeSchedulerPrototype.scheduleRelativeWithState = function (state, dueTime, action) {
            var runAt = this.add(this.clock, dueTime);
            return this.scheduleAbsoluteWithState(state, runAt, action);
        };

        /**
         * Schedules an action to be executed at dueTime.
         * 
         * @memberOf VirtualTimeScheduler#         
         * @param {Number} dueTime Relative time after which to execute the action.
         * @param {Function} action Action to be executed.
         * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
         */          
        VirtualTimeSchedulerPrototype.scheduleRelative = function (dueTime, action) {
            return this.scheduleRelativeWithState(action, dueTime, invokeAction);
        };    

        /** 
         * Starts the virtual time scheduler. 
         * 
         * @memberOf VirtualTimeScheduler#
         */
        VirtualTimeSchedulerPrototype.start = function () {
            var next;
            if (!this.isEnabled) {
                this.isEnabled = true;
                do {
                    next = this.getNext();
                    if (next !== null) {
                        if (this.comparer(next.dueTime, this.clock) > 0) {
                            this.clock = next.dueTime;
                        }
                        next.invoke();
                    } else {
                        this.isEnabled = false;
                    }
                } while (this.isEnabled);
            }
        };

        /** 
         * Stops the virtual time scheduler. 
         * 
         * @memberOf VirtualTimeScheduler#   
         */
        VirtualTimeSchedulerPrototype.stop = function () {
            this.isEnabled = false;
        };

        /**
         * Advances the scheduler's clock to the specified time, running all work till that point.
         *
         * @param {Number} time Absolute time to advance the scheduler's clock to.
         */
        VirtualTimeSchedulerPrototype.advanceTo = function (time) {
            var next;
            var dueToClock = this.comparer(this.clock, time);
            if (this.comparer(this.clock, time) > 0) {
                throw new Error(argumentOutOfRange);
            }
            if (dueToClock === 0) {
                return;
            }
            if (!this.isEnabled) {
                this.isEnabled = true;
                do {
                    next = this.getNext();
                    if (next !== null && this.comparer(next.dueTime, time) <= 0) {
                        if (this.comparer(next.dueTime, this.clock) > 0) {
                            this.clock = next.dueTime;
                        }
                        next.invoke();
                    } else {
                        this.isEnabled = false;
                    }
                } while (this.isEnabled);
                this.clock = time;
            }
        };

        /**
         * Advances the scheduler's clock by the specified relative time, running all work scheduled for that timespan.
         *
         * @memberOf VirtualTimeScheduler#
         * @param {Number} time Relative time to advance the scheduler's clock by.
         */
        VirtualTimeSchedulerPrototype.advanceBy = function (time) {
            var dt = this.add(this.clock, time);
            var dueToClock = this.comparer(this.clock, dt);
            if (dueToClock > 0) {
                throw new Error(argumentOutOfRange);
            }
            if (dueToClock === 0) {
                return;
            }
            return this.advanceTo(dt);
        };        

        /**
         * Advances the scheduler's clock by the specified relative time.
         *
         * @memberOf VirtualTimeScheduler#         
         * @param {Number} time Relative time to advance the scheduler's clock by.
         */
        VirtualTimeSchedulerPrototype.sleep = function (time) {
            var dt = this.add(this.clock, time);

            if (this.comparer(this.clock, dt) >= 0) {
                throw new Error(argumentOutOfRange);
            }

            this.clock = dt;
        };

        /**
         * Gets the next scheduled item to be executed.
         *
         * @memberOf VirtualTimeScheduler#             
         * @returns {ScheduledItem} The next scheduled item.
         */          
        VirtualTimeSchedulerPrototype.getNext = function () {
            var next;
            while (this.queue.length > 0) {
                next = this.queue.peek();
                if (next.isCancelled()) {
                    this.queue.dequeue();
                } else {
                    return next;
                }
            }
            return null;
        };

        /**
         * Schedules an action to be executed at dueTime.
         *
         * @memberOf VirtualTimeScheduler#         
         * @param {Scheduler} scheduler Scheduler to execute the action on.
         * @param {Number} dueTime Absolute time at which to execute the action.
         * @param {Function} action Action to be executed.
         * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
         */           
        VirtualTimeSchedulerPrototype.scheduleAbsolute = function (dueTime, action) {
            return this.scheduleAbsoluteWithState(action, dueTime, invokeAction);
        };

        /**
         * Schedules an action to be executed at dueTime.
         *
         * @memberOf VirtualTimeScheduler#
         * @param {Mixed} state State passed to the action to be executed.
         * @param {Number} dueTime Absolute time at which to execute the action.
         * @param {Function} action Action to be executed.
         * @returns {Disposable} The disposable object used to cancel the scheduled action (best effort).
         */
        VirtualTimeSchedulerPrototype.scheduleAbsoluteWithState = function (state, dueTime, action) {
            var self = this,
                run = function (scheduler, state1) {
                    self.queue.remove(si);
                    return action(scheduler, state1);
                },
                si = new ScheduledItem(self, state, run, dueTime, self.comparer);
            self.queue.enqueue(si);
            return si.disposable;
        };

        return VirtualTimeScheduler;
    }(Scheduler));

    /** Provides a virtual time scheduler that uses Date for absolute time and number for relative time. */
    Rx.HistoricalScheduler = (function (_super) {
        inherits(HistoricalScheduler, _super);

        /**
         * Creates a new historical scheduler with the specified initial clock value.
         * 
         * @constructor
         * @param {Number} initialClock Initial value for the clock.
         * @param {Function} comparer Comparer to determine causality of events based on absolute time.
         */
        function HistoricalScheduler(initialClock, comparer) {
            var clock = initialClock == null ? 0 : initialClock;
            var cmp = comparer || defaultSubComparer;
            _super.call(this, clock, cmp);
        }

        var HistoricalSchedulerProto = HistoricalScheduler.prototype;

        /**
         * Adds a relative time value to an absolute time value.
         * 
         * @memberOf HistoricalScheduler
         * @param {Number} absolute Absolute virtual time value.
         * @param {Number} relative Relative virtual time value to add.
         * @return {Number} Resulting absolute virtual time sum value.
         */
        HistoricalSchedulerProto.add = function (absolute, relative) {
            return absolute + relative;
        };

        /**
         * @private
         * @memberOf HistoricalScheduler
         */
        HistoricalSchedulerProto.toDateTimeOffset = function (absolute) {
            return new Date(absolute).getTime();
        };

        /**
         * Converts the TimeSpan value to a relative virtual time value.
         * 
         * @memberOf HistoricalScheduler         
         * @param {Number} timeSpan TimeSpan value to convert.
         * @return {Number} Corresponding relative virtual time value.
         */
        HistoricalSchedulerProto.toRelative = function (timeSpan) {
            return timeSpan;
        };

        return HistoricalScheduler;    
    }(Rx.VirtualTimeScheduler));
    return Rx;
}));